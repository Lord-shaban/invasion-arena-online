import { DurableObject } from 'cloudflare:workers'
import { applyCommand, createMatch } from '../src/game/engine'
import { viewForPlayer, viewPublic } from '../src/game/visibility'
import type { GameEvent, MatchState, PlayerInput } from '../src/game/model'
import { isClientMessage, type ServerMessage } from '../src/worker/protocol'
import type { Env } from './env'

interface RoomPlayer extends PlayerInput { secretHash: string }
interface RoomData {
  code: string
  hostId: string
  players: RoomPlayer[]
  match: MatchState | null
  seen: Record<string, string[]>
  eventLog: Array<{ seq: number; type: string; at: number }>
  recentEvents: GameEvent[]
}
interface SocketIdentity { playerId: string; authenticated: true }

export class Room extends DurableObject<Env> {
  private data: RoomData | null = null
  private loading: Promise<void> | null = null

  private async load() {
    if (this.data) return
    if (!this.loading) this.loading = this.ctx.storage.get<RoomData>('room').then((value) => { this.data = value ?? null })
    await this.loading
  }
  private async save() { if (this.data) await this.ctx.storage.put('room', this.data) }
  async fetch(request: Request): Promise<Response> {
    await this.load()
    const path = new URL(request.url).pathname
    if (path === '/create' && request.method === 'POST') return this.create(request)
    if (path === '/join' && request.method === 'POST') return this.join(request)
    if (path === '/start' && request.method === 'POST') return this.start(request)
    if (path === '/socket') return this.socket(request)
    return Response.json({ error: 'Not found.' }, { status: 404 })
  }
  private async create(request: Request) {
    if (this.data) return Response.json({ error: 'رمز الغرفة مستخدم بالفعل.' }, { status: 409 })
    const body = await request.json() as { displayName?: string }
    const id = crypto.randomUUID(), secret = makeSecret()
    this.data = { code: this.ctx.id.name ?? '', hostId: id, players: [{ id, name: body.displayName!.trim(), secretHash: await hash(secret) }], match: null, seen: {}, eventLog: [], recentEvents: [] }
    await this.save()
    return Response.json({ roomCode: this.ctx.id.name, playerId: id, rejoinSecret: secret, hostId: id })
  }
  private async join(request: Request) {
    const data = this.data; if (!data) return Response.json({ error: 'الغرفة غير موجودة.' }, { status: 404 })
    if (data.match) return Response.json({ error: 'بدأت المباراة بالفعل.' }, { status: 409 })
    if (data.players.length >= 5) return Response.json({ error: 'الغرفة ممتلئة.' }, { status: 409 })
    const body = await request.json() as { displayName?: string }
    if (data.players.some((p) => p.name.toLowerCase() === body.displayName!.trim().toLowerCase())) return Response.json({ error: 'الاسم مستخدم في هذه الغرفة.' }, { status: 409 })
    const playerId = crypto.randomUUID(), rejoinSecret = makeSecret()
    data.players.push({ id: playerId, name: body.displayName!.trim(), secretHash: await hash(rejoinSecret) })
    await this.save(); await this.broadcast()
    return Response.json({ roomCode: this.ctx.id.name, playerId, rejoinSecret, hostId: data.hostId })
  }
  private async start(request: Request) {
    const data = this.data; if (!data) return Response.json({ error: 'الغرفة غير موجودة.' }, { status: 404 })
    const body = await request.json() as { playerId?: string; secret?: string }
    const host = data.players.find((p) => p.id === body.playerId)
    if (!host || host.id !== data.hostId || !body.secret || await hash(body.secret) !== host.secretHash) return Response.json({ error: 'المضيف فقط يمكنه بدء المباراة.' }, { status: 403 })
    if (data.players.length < 2) return Response.json({ error: 'تحتاج الغرفة إلى لاعبين على الأقل.' }, { status: 409 })
    if (!data.match) data.match = createMatch(this.ctx.id.name ?? data.code, data.players.map(({ id, name }) => ({ id, name })), crypto.randomUUID())
    await this.save(); await this.broadcast()
    return Response.json({ ok: true })
  }
  private socket(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade', { status: 426 })
    const pair = new WebSocketPair(), client = pair[0], server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ authenticated: false })
    return new Response(null, { status: 101, webSocket: client })
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 16_384) { ws.close(1009, 'Message too large'); return }
    let value: unknown
    try { value = JSON.parse(message) } catch { ws.close(1003, 'Invalid JSON'); return }
    const attachment = ws.deserializeAttachment() as Partial<SocketIdentity> | { authenticated?: false } | null
    const data = this.data
    if (!data) { ws.close(1011, 'Room unavailable'); return }
    if (!attachment || attachment.authenticated !== true) {
      const auth = value as { type?: unknown; secret?: unknown }
      if (auth?.type !== 'auth' || typeof auth.secret !== 'string') { ws.close(1008, 'Authenticate first'); return }
      const match = await hash(auth.secret), player = data.players.find((p) => p.secretHash === match)
      if (!player) { ws.close(1008, 'Invalid session'); return }
      ws.serializeAttachment({ authenticated: true, playerId: player.id } satisfies SocketIdentity)
      this.send(ws, this.snapshot(player.id)); return
    }
    const playerId = attachment.playerId!
    if (!isClientMessage(value) || value.type === 'auth') { ws.close(1003, 'Invalid message'); return }
    if (value.type === 'resync') { this.send(ws, this.snapshot(playerId)); return }
    if (!data.match) { this.send(ws, this.snapshot(playerId)); return }
    const actionIds = data.seen[playerId] ?? []
    if (actionIds.includes(value.actionId)) { this.send(ws, this.snapshot(playerId)); return }
    if (value.expectedSeq !== data.match.seq) { this.send(ws, { type: 'rejected', actionId: value.actionId, reason: 'stale-command', seq: data.match.seq }); return }
    const result = applyCommand(data.match, playerId, value.command)
    if (!result.ok) { this.send(ws, { type: 'rejected', actionId: value.actionId, reason: result.reason, seq: data.match.seq }); return }
    data.match = result.state
    data.recentEvents = result.events
    data.seen[playerId] = [...actionIds, value.actionId].slice(-100)
    data.eventLog.push(...result.events.map((event) => ({ seq: data.match!.seq, type: event.type, at: Date.now() })))
    data.eventLog = data.eventLog.slice(-200)
    await this.save()
    await this.broadcast()
  }
  async webSocketClose(ws: WebSocket) { ws.close() }
  async webSocketError(ws: WebSocket) { ws.close(1011, 'Connection error') }
  private snapshot(playerId: string): ServerMessage {
    const data = this.data!
    const pub = data.match ? viewPublic(data.match) : null
    return { type: 'snapshot', seq: data.match?.seq ?? data.players.length, public: pub, private: data.match ? viewForPlayer(data.match, playerId) : null, events: data.recentEvents,
      lobby: { hostId: data.hostId, players: data.players.map(({ id, name }) => ({ id, name })), started: !!data.match } }
  }
  private async broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Partial<SocketIdentity> | null
      if (attachment?.authenticated && attachment.playerId) this.send(ws, this.snapshot(attachment.playerId))
    }
  }
  private send(ws: WebSocket, message: ServerMessage) { try { ws.send(JSON.stringify(message)) } catch { ws.close() } }
}

function makeSecret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, '0')).join('') }
async function hash(secret: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, '0')).join('')
}

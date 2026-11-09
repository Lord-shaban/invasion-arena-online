import type { GameCommand } from '../game/model'
import type { ServerMessage } from '../worker/protocol'

export interface Credentials { roomCode: string; playerId: string; rejoinSecret: string; hostId: string }
const KEY = 'invasion-arena-session'
export const readCredentials = (): Credentials | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') as Credentials | null } catch { return null } }
export const saveCredentials = (value: Credentials) => localStorage.setItem(KEY, JSON.stringify(value))
export const clearCredentials = () => localStorage.removeItem(KEY)
async function post<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
  return value
}
export function createRoom(displayName: string) { return post<Credentials>('/api/rooms', { displayName }) }
export function joinRoom(roomCode: string, displayName: string) { return post<Credentials>(`/api/rooms/${encodeURIComponent(roomCode.toUpperCase())}/join`, { displayName }) }
export function startMatch(credentials: Credentials) { return post<{ ok: boolean }>(`/api/rooms/${credentials.roomCode}/start`, { playerId: credentials.playerId, secret: credentials.rejoinSecret }) }
export function connectRoom(credentials: Credentials, onMessage: (message: ServerMessage) => void, onStatus: (status: string) => void) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${scheme}//${location.host}/api/rooms/${credentials.roomCode}/socket`)
  socket.onopen = () => { onStatus('متصل'); socket.send(JSON.stringify({ type: 'auth', secret: credentials.rejoinSecret })) }
  socket.onclose = () => onStatus('انقطع الاتصال')
  socket.onerror = () => onStatus('مشكلة في الاتصال')
  socket.onmessage = (event: MessageEvent<string>) => { try { onMessage(JSON.parse(event.data) as ServerMessage) } catch { onStatus('رسالة غير مفهومة من الخادم') } }
  return socket
}
export function sendCommand(socket: WebSocket, seq: number, command: GameCommand) {
  socket.send(JSON.stringify({ type: 'command', actionId: crypto.randomUUID(), expectedSeq: seq, command }))
}

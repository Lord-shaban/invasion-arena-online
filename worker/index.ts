import type { Env } from './env'
import { Room } from './room'

export { Room }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'invasion-arena-online' })
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await jsonBody(request)
      if (!body || !validName(body.displayName)) return Response.json({ error: 'اسم اللاعب مطلوب (2–24 حرفًا).' }, { status: 400 })
      const roomCode = randomCode()
      return roomRequest(env, roomCode, '/create', { displayName: body.displayName.trim() }, 201)
    }
    const route = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{5,7})\/(join|start|socket)$/)
    if (route) {
      const [, code, action] = route
      if (action === 'socket') return env.ROOMS.getByName(code).fetch(new Request(`https://room/socket`, request))
      if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })
      const body = await jsonBody(request)
      if (!body) return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
      if (action === 'join' && !validName(body.displayName)) return Response.json({ error: 'اسم اللاعب مطلوب (2–24 حرفًا).' }, { status: 400 })
      return roomRequest(env, code, `/${action}`, body, action === 'join' ? 201 : 200)
    }
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Not found.' }, { status: 404 })

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

async function jsonBody(request: Request): Promise<Record<string, any> | null> {
  if (Number(request.headers.get('content-length') || 0) > 8192) return null
  try { const value = await request.json(); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null } catch { return null }
}
function validName(value: unknown): value is string { return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 24 }
function randomCode() { const bytes = crypto.getRandomValues(new Uint8Array(5)); return Array.from(bytes, (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('') }
async function roomRequest(env: Env, code: string, path: string, body: Record<string, unknown>, status = 200) {
  const response = await env.ROOMS.getByName(code).fetch(`https://room${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const headers = new Headers(response.headers); if (response.ok) headers.set('x-room-status', String(status))
  return new Response(response.body, { status: response.ok ? status : response.status, headers })
}

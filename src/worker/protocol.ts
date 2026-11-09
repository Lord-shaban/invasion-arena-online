import type { GameCommand, GameEvent, PlayerSnapshot, PublicSnapshot, RuleErrorCode } from '../game/model'

export type ClientMessage =
  | { type: 'auth'; secret: string }
  | { type: 'resync' }
  | { type: 'command'; actionId: string; expectedSeq: number; command: GameCommand }
export type ServerMessage =
  | { type: 'snapshot'; seq: number; public: PublicSnapshot | null; private: PlayerSnapshot | null; events?: GameEvent[]; lobby?: { hostId: string; players: Array<{ id: string; name: string }>; started: boolean } }
  | { type: 'rejected'; actionId: string; reason: RuleErrorCode | 'unauthorized' | 'stale-command'; seq: number }

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.type === 'auth') return typeof v.secret === 'string' && v.secret.length >= 20
  if (v.type === 'resync') return true
  if (v.type !== 'command' || typeof v.actionId !== 'string' || !v.actionId.length || v.actionId.length > 80 || !Number.isSafeInteger(v.expectedSeq) || (v.expectedSeq as number) < 0) return false
  if (!v.command || typeof v.command !== 'object' || Array.isArray(v.command)) return false
  const c = v.command as Record<string, unknown>
  if (typeof c.type !== 'string') return false
  if (c.type === 'end-phase' || c.type === 'pass-response') return true
  if (['deploy-resource', 'deploy-defense', 'play-event', 'play-logistics', 'play-ransomware', 'respond-counter', 'offer-ally-card'].includes(c.type)) return typeof c.cardUid === 'string'
  if (c.type === 'activate-leader') return typeof c.cardId === 'string' && Array.isArray(c.sacrificeUids) && c.sacrificeUids.every((x) => typeof x === 'string') && (c.targetId === undefined || typeof c.targetId === 'string')
  if (c.type === 'attack') return typeof c.cardUid === 'string' && typeof c.targetId === 'string' && ['enhancedUid', 'allyId', 'allyCardUid', 'militaryUid', 'resourceUid'].every((key) => c[key] === undefined || typeof c[key] === 'string')
  if (c.type === 'respond-defense') return ['cardUid', 'allyId', 'allyCardUid', 'militaryUid'].every((key) => c[key] === undefined || typeof c[key] === 'string')
  if (c.type === 'set-ally-consent') return typeof c.consent === 'boolean'
  return false
}

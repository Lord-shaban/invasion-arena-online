import type { CARDS } from './cards'

export type CardId = (typeof CARDS)[number]['id']
export type GamePhase = 'draw' | 'main' | 'battle' | 'response' | 'skipped' | 'end'
export type MatchStatus = 'playing' | 'finished'

export interface PlayerInput {
  id: string
  name: string
}

export interface CardInstance {
  uid: string
  cardId: CardId
}

export interface LeaderState {
  cardId: CardId
  skillUsed: boolean
}

export interface PlayerEffects {
  skipDrawTurns: number
  skipTurns: number
  attackBuff: number
  attackBuffTurns: number
  defenseBuff: number
  defenseBuffTurns: number
  defenseDisabledTurns: number
  retainOverflow: boolean
  allyConsent: boolean
}

export interface DefenseState {
  card: CardInstance
  durability: number
}

export interface PlayerState extends PlayerInput {
  hp: number
  alive: boolean
  leaders: LeaderState[]
  hand: CardInstance[]
  resources: CardInstance[]
  defense: DefenseState | null
  effects: PlayerEffects
}

export type AttackEffect =
  | { type: 'none' }
  | { type: 'skip-draw'; turns: number }
  | { type: 'destroy-resources'; count: number }
  | { type: 'steal-resources'; count: number }
  | { type: 'steal-hand'; count: number }
  | { type: 'draw'; count: number }

export interface PendingAttack {
  id: string
  attackerId: string
  targetId: string
  card: CardInstance
  damage: number
  effect: AttackEffect
  doubled: boolean
  counterDepth: number
}

export interface GameEvent {
  id: string
  type: string
  text: string
  actorId?: string
  targetId?: string
  amount?: number
}

export interface MatchState {
  roomId: string
  status: MatchStatus
  ruleset: 'ruleset-v1'
  players: PlayerState[]
  drawPile: CardInstance[]
  graveyard: CardInstance[]
  currentPlayerId: string
  phase: GamePhase
  round: number
  stage: number
  actedThisRound: string[]
  pendingAttack: PendingAttack | null
  allyOffers: Record<string, string>
  truceUntilRound: number
  defenseShutdownUntilRound: number
  seq: number
  nextInstanceId: number
  winnerId: string | null
}

export type GameCommand =
  | { type: 'end-phase' }
  | { type: 'deploy-resource'; cardUid: string }
  | { type: 'deploy-defense'; cardUid: string }
  | { type: 'activate-leader'; cardId: CardId; sacrificeUids: string[]; targetId?: string }
  | { type: 'attack'; cardUid: string; targetId: string; enhancedUid?: string; allyId?: string; allyCardUid?: string; militaryUid?: string; resourceUid?: string }
  | { type: 'offer-ally-card'; cardUid: string }
  | { type: 'play-event'; cardUid: string }
  | { type: 'play-logistics'; cardUid: string }
  | { type: 'set-ally-consent'; consent: boolean }
  | { type: 'respond-defense'; cardUid?: string; allyId?: string; allyCardUid?: string; militaryUid?: string }
  | { type: 'respond-counter'; cardUid: string }
  | { type: 'play-ransomware'; cardUid: string }
  | { type: 'pass-response' }

export interface PlayerSnapshot {
  playerId: string
  hand: CardInstance[]
  resources: CardInstance[]
  allyConsent: boolean
  allyOffers: Array<{ playerId: string; card: CardInstance }>
  legalActions: string[]
}

export interface PublicSnapshot {
  roomId: string
  status: MatchStatus
  seq: number
  players: Array<Pick<PlayerState, 'id' | 'name' | 'hp' | 'alive' | 'leaders' | 'defense'> & { resourceCount: number; handCount: number }>
  currentPlayerId: string
  phase: GamePhase
  round: number
  stage: number
  pendingAttack: (Omit<PendingAttack, 'card'> & { cardId: CardId }) | null
  drawCount: number
  graveyardCount: number
  winnerId: string | null
}

export type RuleErrorCode =
  | 'match-finished' | 'unknown-player' | 'player-eliminated' | 'wrong-turn' | 'wrong-phase'
  | 'invalid-card' | 'invalid-target' | 'invalid-cost' | 'leader-used' | 'missing-defense'
  | 'stale-command' | 'needs-consent' | 'pending-response' | 'no-pending-attack' | 'invalid-action'

export type TransitionResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; reason: RuleErrorCode }

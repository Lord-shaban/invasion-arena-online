import { CARDS } from './cards'
import type { CardId, CardInstance } from './model'

export const RULESET_VERSION = 'ruleset-v1' as const
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 5
export const STARTING_HP = 6000
export const STARTING_HAND = 5
export const HAND_LIMIT = 5

export const STAGE_TRACK: ReadonlyArray<{ stage: number; cardId: CardId }> = [
  { stage: 1, cardId: 'evt-airdrop' },
  { stage: 2, cardId: 'evt-black-market' },
  { stage: 3, cardId: 'evt-truce' },
  { stage: 4, cardId: 'evt-omega-pulse' },
  { stage: 5, cardId: 'evt-scorched-earth' },
]

export function seedRandom(seed: string): () => number {
  let value = 2166136261
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function buildSharedDeck(makeCard: (cardId: CardId) => CardInstance, seed: string): CardInstance[] {
  const cards: CardInstance[] = []
  for (const definition of CARDS) {
    if (definition.cat === 'characters') continue
    const copies = definition.cat === 'events' ? 1 : 3
    for (let i = 0; i < copies; i++) cards.push(makeCard(definition.id))
  }
  return shuffle(cards, seedRandom(seed))
}

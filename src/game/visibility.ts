import type { MatchState, PlayerSnapshot, PublicSnapshot } from './model'

export function viewForPlayer(state: MatchState, playerId: string): PlayerSnapshot {
  const player = state.players.find((item) => item.id === playerId)
  if (!player) throw new Error('Unknown player')
  const legalActions = state.status !== 'playing' || !player.alive ? []
    : state.pendingAttack ? state.pendingAttack.targetId === playerId ? ['respond-defense', 'respond-counter', 'pass-response'] : []
      : state.currentPlayerId === playerId
        ? state.phase === 'main' ? ['deploy-resource', 'deploy-defense', 'activate-leader', 'end-phase']
          : state.phase === 'battle' ? ['attack', 'play-event', 'play-logistics', 'end-phase']
            : ['end-phase']
        : []
  if (state.phase === 'battle' && player.effects.allyConsent && state.currentPlayerId !== playerId && !state.pendingAttack) legalActions.push('offer-ally-card')
  const allyOffers = state.currentPlayerId === playerId ? Object.entries(state.allyOffers).flatMap(([id, uid]) => {
    const offeredBy = state.players.find((item) => item.id === id), card = offeredBy?.hand.find((item) => item.uid === uid)
    return card ? [{ playerId: id, card }] : []
  }) : []
  return { playerId, hand: player.hand, resources: player.resources, allyConsent: player.effects.allyConsent, allyOffers, legalActions }
}

export function viewPublic(state: MatchState): PublicSnapshot {
  return {
    roomId: state.roomId, status: state.status, seq: state.seq,
    players: state.players.map(({ id, name, hp, alive, leaders, defense, hand, resources }) => ({
      id, name, hp, alive, leaders, defense, resourceCount: resources.length, handCount: hand.length,
    })),
    currentPlayerId: state.currentPlayerId, phase: state.phase, round: state.round, stage: state.stage,
    pendingAttack: state.pendingAttack ? { ...state.pendingAttack, cardId: state.pendingAttack.card.cardId } : null,
    drawCount: state.drawPile.length, graveyardCount: state.graveyard.length, winnerId: state.winnerId,
  }
}

import { CARDS } from './cards'
import type { AttackEffect, CardId, CardInstance, GameCommand, GameEvent, MatchState, PlayerInput, PlayerState, RuleErrorCode, TransitionResult } from './model'
import { buildSharedDeck, HAND_LIMIT, MAX_PLAYERS, MIN_PLAYERS, RULESET_VERSION, seedRandom, shuffle, STAGE_TRACK, STARTING_HAND, STARTING_HP } from './rules'

const card = (id: CardId) => CARDS.find((item) => item.id === id)!
const power = (id: CardId) => { const definition = card(id); return 'power' in definition ? definition.power : undefined }
const num = (value: string | undefined) => Number(value?.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[^0-9]/g, '') || 0)
const currency = (c: CardInstance) => c.cardId === 'res-energicore' ? 0 : num(power(c.cardId))
const playerEffects = () => ({ skipDrawTurns: 0, skipTurns: 0, attackBuff: 0, attackBuffTurns: 0, defenseBuff: 0, defenseBuffTurns: 0, defenseDisabledTurns: 0, retainOverflow: false, allyConsent: false })

export function createMatch(roomId: string, players: PlayerInput[], seed: string): MatchState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) throw new Error('A match needs 2–5 players')
  const random = seedRandom(seed)
  let next = 1
  const make = (cardId: CardId): CardInstance => ({ uid: `c${next++}`, cardId })
  const leaders = shuffle(CARDS.filter((item) => item.cat === 'characters').map((item) => item.id), random)
  const deck = buildSharedDeck(make, seed)
  const states: PlayerState[] = players.map((p) => ({ ...p, hp: STARTING_HP, alive: true,
    leaders: [leaders.pop()!, leaders.pop()!].map((cardId) => ({ cardId, skillUsed: false })),
    hand: Array.from({ length: STARTING_HAND }, () => deck.pop()!), resources: [], defense: null, effects: playerEffects() }))
  const first = states[Math.floor(random() * states.length)]
  const state: MatchState = { roomId, status: 'playing', ruleset: RULESET_VERSION, players: states, drawPile: deck,
    graveyard: [], currentPlayerId: first.id, phase: 'draw', round: 1, stage: 1, actedThisRound: [], pendingAttack: null, allyOffers: {},
    truceUntilRound: 0, defenseShutdownUntilRound: 0, seq: 0, nextInstanceId: next, winnerId: null }
  applyStage(state, 1)
  return state
}

function emit(events: GameEvent[], type: string, text: string, actorId?: string, targetId?: string, amount?: number) {
  events.push({ id: `event-${events.length + 1}`, type, text, actorId, targetId, amount })
}
function draw(state: MatchState, p: PlayerState, count: number) {
  for (let i = 0; i < count; i++) {
    if (!state.drawPile.length && state.graveyard.length) {
      state.drawPile = shuffle(state.graveyard.splice(0), seedRandom(`${state.roomId}:${state.seq}:${i}`))
    }
    const c = state.drawPile.pop()
    if (c) p.hand.push(c)
  }
}
function discard(state: MatchState, p: PlayerState, c: CardInstance) {
  const i = p.hand.findIndex((item) => item.uid === c.uid)
  if (i >= 0) state.graveyard.push(...p.hand.splice(i, 1))
}
function living(state: MatchState) { return state.players.filter((p) => p.alive) }
function damage(state: MatchState, p: PlayerState, amount: number) {
  p.hp = Math.max(0, p.hp - Math.max(0, amount))
  if (!p.hp) {
    p.alive = false
    state.graveyard.push(...p.hand, ...p.resources)
    if (p.defense) state.graveyard.push(p.defense.card)
    p.hand = []; p.resources = []; p.defense = null; p.leaders = []
    if (living(state).length <= 1) { state.status = 'finished'; state.winnerId = living(state)[0]?.id ?? null }
  }
}
function applyStage(state: MatchState, stage: number) {
  if (stage === 1) state.players.filter((p) => p.alive).forEach((p) => draw(state, p, 2))
  if (stage === 2) state.players.filter((p) => p.alive).forEach((p) => { state.graveyard.push(...p.hand); p.hand = []; draw(state, p, 3) })
  if (stage === 3) state.truceUntilRound = state.round
    if (stage === 4) {
      state.defenseShutdownUntilRound = state.round
      state.players.forEach((p) => { if (p.defense) state.graveyard.push(p.defense.card); p.defense = null })
    }
  if (stage === 5) state.players.forEach((p) => { state.graveyard.push(...p.resources); p.resources = [] })
}
function effectFor(id: CardId): AttackEffect {
  if (id === 'atk-comms-jam') return { type: 'skip-draw', turns: 1 }
  if (id === 'atk-sabotage') return { type: 'destroy-resources', count: 1 }
  if (id === 'atk-embezzlement') return { type: 'steal-resources', count: 1 }
  if (id === 'atk-secret-agent') return { type: 'steal-hand', count: 1 }
  return { type: 'none' }
}
function resolve(state: MatchState, a: NonNullable<MatchState['pendingAttack']>, events: GameEvent[], blocked = 0, cancelEffect = false) {
  const target = state.players.find((p) => p.id === a.targetId)!
  const attacker = state.players.find((p) => p.id === a.attackerId)!
  const dealt = Math.max(0, a.damage - blocked)
  damage(state, target, dealt)
  let effectCancelled = cancelEffect
  const resourceTargets = target.resources.filter((item) => item.cardId !== 'sp-ransomware')
  if (!effectCancelled && (a.effect.type === 'destroy-resources' || a.effect.type === 'steal-resources') && target.resources.some((item) => item.cardId === 'sp-ransomware')) {
    if (attacker.resources.length >= 2) {
      target.resources.push(...attacker.resources.splice(0, 2))
      emit(events, 'ransomware-paid', 'دفع المهاجم موردين لفيروس الفدية', attacker.id, target.id)
    } else {
      effectCancelled = true
      emit(events, 'ransomware-blocked', 'تعذر دفع فدية الموردين؛ حُمي مورد الهدف', attacker.id, target.id)
    }
  }
  if (!effectCancelled) {
    const e = a.effect
    if (e.type === 'skip-draw') target.effects.skipDrawTurns += e.turns
    if (e.type === 'destroy-resources' || e.type === 'steal-resources') {
      const affected = resourceTargets.slice(0, e.count)
      const affectedIds = new Set(affected.map((item) => item.uid))
      target.resources = target.resources.filter((item) => !affectedIds.has(item.uid))
      if (e.type === 'destroy-resources') state.graveyard.push(...affected)
      else attacker.resources.push(...affected)
    }
    if (e.type === 'steal-hand' && target.hand.length) attacker.hand.push(...target.hand.splice(0, 1))
  }
  emit(events, 'attack-resolved', dealt ? `تم إلحاق ${dealt} ضرر` : 'تم صد الهجوم', attacker.id, target.id, dealt)
  state.pendingAttack = null
}

export function applyCommand(original: MatchState, playerId: string, command: GameCommand): TransitionResult {
  if (original.status !== 'playing') return { ok: false, reason: 'match-finished' }
  const p0 = original.players.find((x) => x.id === playerId)
  if (!p0) return { ok: false, reason: 'unknown-player' }
  if (!p0.alive) return { ok: false, reason: 'player-eliminated' }
  const response = original.pendingAttack?.targetId === playerId
  const allyOffering = command.type === 'offer-ally-card'
  if (!response && original.pendingAttack) return { ok: false, reason: 'pending-response' }
  if (response && !['respond-defense', 'respond-counter', 'pass-response'].includes(command.type)) return { ok: false, reason: 'pending-response' }
  if (!response && !allyOffering && original.currentPlayerId !== playerId) return { ok: false, reason: 'wrong-turn' }
  const s = structuredClone(original), p = s.players.find((x) => x.id === playerId)!, events: GameEvent[] = []
  const fail = (reason: RuleErrorCode): TransitionResult => ({ ok: false, reason })
  const owned = (uid: string) => p.hand.find((c) => c.uid === uid)
  if (command.type === 'offer-ally-card') {
    if (s.phase !== 'battle' || s.pendingAttack || !p.effects.allyConsent || p.id === s.currentPlayerId) return fail('invalid-action')
    const offered = owned(command.cardUid)
    if (!offered || card(offered.cardId).cat !== 'attack' || card(offered.cardId).sub !== 'هجوم مباشر') return fail('invalid-card')
    s.allyOffers[p.id] = offered.uid; s.seq++; emit(events, 'ally-offer', 'تم تجهيز بطاقة دعم عسكري', p.id)
    return { ok: true, state: s, events }
  }
  if (command.type === 'pass-response') resolve(s, s.pendingAttack!, events)
  else if (command.type === 'respond-defense') {
    const a = s.pendingAttack!, defCard = command.cardUid ? owned(command.cardUid) : null
    if (command.cardUid && !defCard) return fail('invalid-card')
    if (p.effects.defenseDisabledTurns > 0 || s.defenseShutdownUntilRound >= s.round) return fail('missing-defense')
    if (defCard && ['def-hand-encrypt', 'def-resource-guard'].includes(defCard.cardId)) {
      const matches = defCard.cardId === 'def-hand-encrypt' ? ['atk-comms-jam', 'atk-secret-agent'].includes(a.card.cardId) : ['atk-sabotage', 'atk-embezzlement'].includes(a.card.cardId)
      if (p.defense || !matches) return fail('invalid-action')
      discard(s, p, defCard); resolve(s, a, events, num(power(defCard.cardId)) + p.effects.defenseBuff, true)
    } else if (p.defense) {
      if (p.defense.card.cardId === 'def-protection-protocol') {
        if (!p.resources.length) return fail('invalid-cost')
        s.graveyard.push(p.resources.pop()!)
      }
      const blocked = Math.min(a.damage, p.defense.durability + p.effects.defenseBuff)
      p.defense.durability -= a.damage
      if (p.defense.durability <= 0) { s.graveyard.push(p.defense.card); p.defense = null }
      resolve(s, a, events, blocked)
    } else return fail('missing-defense')
  }
  else if (command.type === 'respond-counter') {
    const c = owned(command.cardUid); if (!c || c.cardId !== 'sp-counter-attack') return fail('invalid-card')
    discard(s, p, c); const a = s.pendingAttack!, attacker = s.players.find((x) => x.id === a.attackerId)!
    s.pendingAttack = { ...a, attackerId: p.id, targetId: attacker.id, damage: a.damage, effect: { type: 'none' } }
  }
  else if (command.type === 'end-phase') {
    if (s.phase === 'draw') { if (p.effects.skipDrawTurns) p.effects.skipDrawTurns--; else if (p.hand.length < HAND_LIMIT) draw(s, p, 1); s.phase = 'main' }
    else if (s.phase === 'main') s.phase = 'battle'
    else if (s.phase === 'battle') s.phase = 'end'
    else if (s.phase === 'end') {
      if (p.hand.length > HAND_LIMIT && !p.effects.retainOverflow) s.graveyard.push(...p.hand.splice(0, p.hand.length - HAND_LIMIT))
      s.actedThisRound.push(p.id); s.allyOffers = {}
      const livingPlayers = living(s), next = livingPlayers.find((x) => !s.actedThisRound.includes(x.id))
      if (next) { s.currentPlayerId = next.id; s.phase = next.effects.skipTurns ? 'skipped' : 'draw'; if (next.effects.skipTurns) next.effects.skipTurns-- }
      else {
        s.actedThisRound = []; s.round++; s.stage = Math.min(5, s.round)
        if (STAGE_TRACK.some((x) => x.stage === s.stage) && s.stage !== original.stage) applyStage(s, s.stage)
        const first = livingPlayers[(livingPlayers.findIndex((x) => x.id === p.id) + 1) % livingPlayers.length]
        s.currentPlayerId = first.id; s.phase = first.effects.skipTurns ? 'skipped' : 'draw'
      }
      if (s.phase === 'skipped') { s.phase = 'end'; s.actedThisRound.push(s.currentPlayerId); const skipped = s.players.find((x) => x.id === s.currentPlayerId)!; skipped.effects.defenseDisabledTurns = Math.max(0, skipped.effects.defenseDisabledTurns - 1) }
      p.effects.defenseDisabledTurns = Math.max(0, p.effects.defenseDisabledTurns - 1)
      p.effects.attackBuffTurns = Math.max(0, p.effects.attackBuffTurns - 1); if (!p.effects.attackBuffTurns) p.effects.attackBuff = 0
      p.effects.defenseBuffTurns = Math.max(0, p.effects.defenseBuffTurns - 1); if (!p.effects.defenseBuffTurns) p.effects.defenseBuff = 0
    } else return fail('wrong-phase')
  }
  else if (command.type === 'deploy-resource' || command.type === 'deploy-defense') {
    if (s.phase !== 'main') return fail('wrong-phase')
    const c = owned(command.cardUid); if (!c) return fail('invalid-card')
    if (command.type === 'deploy-resource') { if (card(c.cardId).cat !== 'resources' && c.cardId !== 'sp-ransomware') return fail('invalid-card'); discard(s, p, c); p.resources.push(c) }
    else { if (card(c.cardId).cat !== 'defense' || !['def-mecha-shield', 'def-hero-shield', 'def-protection-protocol'].includes(c.cardId)) return fail('invalid-card'); if (p.defense) return fail('invalid-action'); discard(s, p, c); p.defense = { card: c, durability: num(power(c.cardId)) } }
  }
  else if (command.type === 'activate-leader') {
    if (s.phase !== 'main') return fail('wrong-phase')
    const leader = p.leaders.find((l) => l.cardId === command.cardId); if (!leader) return fail('invalid-card'); if (leader.skillUsed) return fail('leader-used')
    const targetRequired = ['char-omar', 'char-scorpion', 'char-raven', 'char-hunter', 'char-kaya'].includes(command.cardId)
    const target = command.targetId ? s.players.find((x) => x.id === command.targetId && x.alive && x.id !== p.id) : undefined
    if (targetRequired && !target) return fail('invalid-target')
    if (new Set(command.sacrificeUids).size !== command.sacrificeUids.length) return fail('invalid-cost')
    const sacrifice = command.sacrificeUids.map((uid) => p.resources.find((c) => c.uid === uid))
    if (sacrifice.some((c) => !c)) return fail('invalid-cost')
    const costIds = sacrifice.map((c) => c!.cardId); const costValue = sacrifice.reduce((n, c) => n + currency(c!), 0)
    const req = command.cardId === 'char-sara' ? costValue >= 30 : command.cardId === 'char-ethan' ? costValue >= 20 : command.cardId === 'char-omar' ? costIds.filter((id) => id === 'res-energicore').length >= 3 : costValue >= 10 && costIds.includes('res-energicore')
    if (!req) return fail('invalid-cost')
    s.graveyard.push(...sacrifice as CardInstance[]); p.resources = p.resources.filter((c) => !command.sacrificeUids.includes(c.uid)); leader.skillUsed = true
    if (command.cardId === 'char-sara') p.hp += 3000
    if (command.cardId === 'char-omar' && target) damage(s, target, 2000)
    if (command.cardId === 'char-beast') s.players.filter((x) => x.alive && x.id !== p.id).forEach((x) => damage(s, x, 500))
    if (command.cardId === 'char-scorpion' && target) { const loss = Math.min(1000, target.hp); damage(s, target, 1000); p.hp += loss }
    if (command.cardId === 'char-leo') { p.effects.attackBuff = 1000; p.effects.attackBuffTurns = 2 }
    if (command.cardId === 'char-rolo') { p.effects.defenseBuff = 1000; p.effects.defenseBuffTurns = 2 }
    if (command.cardId === 'char-raven' && target) s.graveyard.push(...target.hand.splice(0))
    if (command.cardId === 'char-hunter' && target) {
      const protectedResource = target.resources.find((item) => item.cardId === 'sp-ransomware')
      let paid = false
      if (protectedResource && p.resources.length >= 2) {
        target.resources.push(...p.resources.splice(0, 2)); paid = true
        emit(events, 'ransomware-paid', 'دفع المهاجم موردين لفيروس الفدية', p.id, target.id)
      }
      const destroyed = target.resources.filter((item) => paid || item.cardId !== 'sp-ransomware')
      const destroyedIds = new Set(destroyed.map((item) => item.uid))
      target.resources = target.resources.filter((item) => !destroyedIds.has(item.uid))
      s.graveyard.push(...destroyed)
      if (protectedResource && !paid) emit(events, 'ransomware-blocked', 'حُمي فيروس الفدية لعدم دفع الموردين', p.id, target.id)
    }
    if (command.cardId === 'char-kaya' && target) { target.effects.skipTurns = Math.max(1, target.effects.skipTurns); target.effects.defenseDisabledTurns = 1 }
    if (command.cardId === 'char-ethan') draw(s, p, 4)
    emit(events, 'leader-skill', `فُعّلت مهارة ${card(command.cardId).name}`, p.id, target?.id)
  }
  else if (command.type === 'attack') {
    if (s.phase !== 'battle') return fail('wrong-phase')
    if (s.round <= s.truceUntilRound) return fail('invalid-action')
    const c = owned(command.cardUid), target = s.players.find((x) => x.id === command.targetId && x.alive && x.id !== p.id)
    if (!c || card(c.cardId).cat !== 'attack' || !target) return fail('invalid-target')
    let ally: PlayerState | undefined, allyAttack: CardInstance | undefined, military: CardInstance | undefined
    if (command.allyId || command.allyCardUid || command.militaryUid) {
      ally = s.players.find((x) => x.id === command.allyId && x.alive && x.id !== p.id && x.id !== target.id)
      allyAttack = ally?.hand.find((x) => x.uid === command.allyCardUid)
      military = owned(command.militaryUid ?? '')
      if (!ally || !ally.effects.allyConsent || s.allyOffers[ally.id] !== command.allyCardUid || !allyAttack || card(allyAttack.cardId).sub !== 'هجوم مباشر' || card(c.cardId).sub !== 'هجوم مباشر' || military?.cardId !== 'sp-military-ally' || command.enhancedUid) return fail('invalid-action')
    }
    const enhanced = command.enhancedUid ? owned(command.enhancedUid) : undefined
    if (command.enhancedUid && enhanced?.cardId !== 'sp-enhanced-attack') return fail('invalid-card')
    const costCard = c.cardId === 'atk-purge-protocol' && command.resourceUid ? p.resources.find((x) => x.uid === command.resourceUid) : null
    if (c.cardId === 'atk-purge-protocol' && !costCard) return fail('invalid-cost')
    if (costCard) { p.resources = p.resources.filter((x) => x.uid !== costCard.uid); s.graveyard.push(costCard) }
    discard(s, p, c); if (enhanced) discard(s, p, enhanced)
    if (ally && allyAttack && military) { discard(s, ally, allyAttack); discard(s, p, military); delete s.allyOffers[ally.id] }
    const bonus = p.effects.attackBuff
    s.pendingAttack = { id: `a${s.seq + 1}`, attackerId: p.id, targetId: target.id, card: c, damage: (num(power(c.cardId)) + (allyAttack ? num(power(allyAttack.cardId)) : 0) + bonus) * (enhanced ? 2 : 1), effect: effectFor(c.cardId), doubled: !!enhanced, counterDepth: 0 }
  }
  else if (command.type === 'play-event') {
    if (s.phase !== 'battle') return fail('wrong-phase')
    const c = owned(command.cardUid); if (!c || card(c.cardId).cat !== 'events') return fail('invalid-card'); discard(s, p, c)
    if (c.cardId === 'evt-airdrop') s.players.filter((x) => x.alive).forEach((x) => draw(s, x, 2))
    if (c.cardId === 'evt-black-market') s.players.filter((x) => x.alive).forEach((x) => { s.graveyard.push(...x.hand); x.hand = []; draw(s, x, 3) })
    if (c.cardId === 'evt-truce') s.truceUntilRound = s.round + 1
    if (c.cardId === 'evt-omega-pulse') { s.defenseShutdownUntilRound = s.round + 1; s.players.forEach((x) => { x.defense = null }) }
    if (c.cardId === 'evt-scorched-earth') s.players.forEach((x) => { s.graveyard.push(...x.resources); x.resources = [] })
  }
  else if (command.type === 'play-logistics') { if (s.phase !== 'battle') return fail('wrong-phase'); const c = owned(command.cardUid); if (!c || c.cardId !== 'sp-logistic-support') return fail('invalid-card'); discard(s, p, c); draw(s, p, 2) }
  else if (command.type === 'play-ransomware') { if (s.phase !== 'main') return fail('wrong-phase'); const c = owned(command.cardUid); if (!c || c.cardId !== 'sp-ransomware') return fail('invalid-card'); discard(s, p, c); p.resources.push(c) }
  else if (command.type === 'set-ally-consent') { if (s.phase !== 'main') return fail('wrong-phase'); p.effects.allyConsent = command.consent }
  else return fail('invalid-action')
  s.seq++
  return { ok: true, state: s, events }
}

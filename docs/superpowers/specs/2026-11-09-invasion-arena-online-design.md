# Invasion Arena Online — Design

**Status:** Proposed; no application code has been created.

## Intent

Create a standalone, Arabic-first browser game where friends can join a room and play Invasion | Civil War online. The server is authoritative: it owns the deck, private hands, turn order, health, resources, defenses, event stages, legal actions, eliminations, and win result. The original static Arena OS remains a reference and is not modified by this project.

Proposed repository: `Lord-shaban/invasion-arena-online` (public GitHub repository, following the visibility of the source project). The new project directory is `invasion-arena-online/`.

## Goals

- Create and join a room using a short code and a display name; no account is needed for the first version.
- Support a complete multiplayer match, from character assignment through the final winner.
- Enforce all implemented rules on the server. Clients send commands, never replacement game state.
- Keep each player's hand and face-down resources private from other players.
- Recover room state after a Worker restart and let a disconnected player rejoin.
- Provide a responsive Arabic RTL interface, with an optional English interface later.
- Start and operate within the providers' no-cost allowances, with quota exhaustion handled visibly and without unexpected paid upgrades.

## Out of scope for the first playable release

- Ranked matchmaking, persistent player accounts, public leaderboards, voice chat, monetization, native mobile apps, bots, and tournaments.
- A 100-player room. The fiction mentions 100 entrants, but the card rules do not define a 100-seat deck or match flow.
- Any game action or ruling that the rules reference does not define unless the provisional rulings below are approved.

## Approaches considered

1. **Authoritative game rooms on Cloudflare (recommended).** React + TypeScript + Vite runs as static assets on Workers. A Worker routes room requests to one SQLite-backed Durable Object per room; that object validates actions and sends private/public views over hibernatable WebSockets. One service hosts the UI and room API, with no separate database service. Cloudflare documents Durable Objects for real-time collaboration and multiplayer games, recommends SQLite-backed objects for new projects, and offers WebSocket hibernation. Static asset requests do not consume Worker request quota. The current Free plan includes 100,000 Worker requests per day, 100,000 Durable Object requests per day, 13,000 GB-s per day, 5 GB of account SQLite storage, and up to 1 GB per SQLite object. Operations that exceed Free limits can fail, so this is free only while usage remains inside those quotas. Sources: [Workers free limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [SQLite-backed storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
2. **Supabase Postgres + Realtime.** Strong fit for accounts, relational data, and history, but the free tier has 200 concurrent Realtime connections and 2 million messages, and low-activity free projects may pause after seven days. The game would also need a trusted transactional authority layered over its channels. Sources: [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [billing quotas](https://supabase.com/docs/guides/platform/billing-on-supabase).
3. **Firebase Realtime Database Spark.** Quick to prototype with client synchronization and no-cost usage up to 100 simultaneous connections, 1 GB stored, and 10 GB monthly downloads. It is less suitable for trusted game rules without a server component; Spark has stricter product availability, and exceeding a product quota can shut that product off for the rest of the month. Sources: [Firebase pricing](https://firebase.google.com/pricing), [Spark plan details](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Realtime Database billing](https://firebase.google.com/docs/database/usage/billing).

**Recommendation:** use approach 1. It matches the per-room state machine and keeps persistence, authoritative logic, and realtime transport together without a database bill. Use Cloudflare's official React + Vite Workers integration and Wrangler for local emulation and deploys: [React + Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/).

## Proposed architecture

- **Client:** React, TypeScript, Vite, Arabic RTL design. It renders a player's authorized snapshot and submits typed actions. It may optimistically show a pending action, but the server snapshot is final.
- **Room routing:** a small Worker handles room creation and routes each room code to its Durable Object. Validate code format and command payloads at the boundary.
- **Room authority:** one Durable Object instance per room serializes commands, validates player/turn/phase/target/card/cost, applies a pure game-engine transition, persists it, then broadcasts updated snapshots.
- **Persistence:** SQLite-backed Durable Object storage. Persist match state, deck order, event log/sequence, player session-token hashes, and schema/rules version. Do not depend on in-memory state surviving hibernation or deploys.
- **Realtime:** hibernatable WebSockets. A public snapshot contains room, turn, active stage, public zones, public health, and public defenses. Each player also receives only their own hand and private resource identities. Reconnect requires a random room-scoped player secret; store only its hash.
- **Engine boundary:** a framework-independent TypeScript game engine accepts `(state, playerId, command)` and returns a validated new state plus emitted events, or a typed rejection. This makes game rules independently testable from the browser and Cloudflare runtime.
- **Content:** port the existing 37 card definitions into typed game data and validate all card IDs/cost/effect references at startup or build time. Separate card definitions, physical deck composition, stage schedule, and rulings so they cannot be conflated.
- **Deployment:** one Workers deployment serves built static assets and the Worker API at a `workers.dev` address. No custom domain is required for a free launch. No billing account or paid-plan switch is part of setup.

## Match flow

1. A player creates a room and receives a short join code and rejoin secret. Others join with the code and a name.
2. The host starts a match when the room is ready. The server shuffles the character pool, deals two distinct leaders per player, shuffles the shared deck, gives each player five cards, sets each player to 6,000 HP, and randomly selects the first player.
3. On each player's turn, the server offers the four phases in order: draw, main, battle, end. The server rejects out-of-turn or out-of-phase commands.
4. In the main phase, the player may deploy resources and activate an unused leader skill only if their validated sacrifice requirements are met.
5. In battle, the player may submit legal attacks, support, and events. A targeted attack creates a pending response for its target. The target may use an allowed defense or counter; the server resolves damage/effects and consumes cards/resources exactly once.
6. At 0 HP, a player is eliminated and cannot submit actions. The match ends when one player remains.
7. Each successful command increments a match sequence number and is committed to storage before acknowledgement. Clients ignore duplicate/older snapshots and request a fresh snapshot after reconnect.

## Security and correctness boundaries

- Never accept health totals, card ownership, deck order, costs paid, legal phase, or winner from a client.
- Derive the player identity from the room's authenticated WebSocket attachment/rejoin secret, not a `playerId` in an action body.
- Send private snapshots per socket; do not broadcast serialized full state and hide fields only in the UI.
- Make each command idempotent with a client action ID, and reject duplicate, stale, malformed, or unauthorized actions.
- Save a transition before broadcasting its success. On a rejected action, return a reason and leave state unchanged.
- Keep a bounded match event log for debugging and replay; do not retain unnecessary player personal data.
- Match secrets are unguessable; apply room-creation and join rate limits where the free platform allows. Public room listing is not in v1.

## Provisional rule rulings requiring approval

The supplied rulebook defines the turn structure and card text but does not define all data needed for an automatic engine. The following are proposals, not official rules. If approved, put them in a versioned `ruleset-v1` document and make the engine follow them consistently.

1. **Seats and characters:** 2–5 players, because ten unique character cards are dealt two per player. Do not duplicate a leader within one match.
2. **Deck composition:** keep the 10 character cards in their own leader pool; use three copies of each of the 22 non-character card types other than events, plus one copy of each of the five event cards, in the shared draw deck (71 cards total). The five arena events also form a fixed stage track. This proposes that an event's stage effect happens automatically on stage entry and a drawn event card can separately be played in battle; the source does not define copies or resolve this overlap.
3. **Stage timing:** start at stage 1 and resolve its event once at match start. Advance one stage after every complete round in which all living players have had a turn. Resolve the new stage event on entry. Stage 3 (truce) and stage 4 (defense shutdown) last through that whole round; stage 5 clears deployed resources once on entry and stays as the current stage. An event card played from a hand applies its card effect to all players, including its player, independently of automatic stage entry.
4. **Resources:** a player knows their own face-down resource cards; opponents see only the count. Costs consume the named/valued cards from the field into the graveyard. Verify that a skill cost can be satisfied before consuming any of it.
5. **Shields:** a public general defense has durability equal to its printed value. An attack subtracts damage from durability; overflow reaches HP; the shield is discarded when durability reaches zero. No two general defenses stack. Protection Protocol pays one resource each time it absorbs an attack.
6. **Defense windows:** a defender may answer one pending attack with an applicable general defense or an applicable special response. A general shield reduces damage but cannot cancel the non-damage effect of a special attack; a matching special defense cancels that attack's listed effect and reduces its damage by its printed 500. Existing general defense blocks use of a special defense as stated in the rulebook.
7. **Combos:** normal attacks resolve separately and cannot merge into one attack unless Enhanced Attack or Military Ally enables it. Enhanced Attack applies to exactly one attack unless the card FAQ explicitly permits a Military Ally combination. Military Ally requires each named participant to consent and contribute the matching card; its defensive use is permitted outside the contributor's turn.
8. **Missing deck / elimination rules:** if the draw pile empties, reshuffle the graveyard into it; exclude cards still on the board and character cards. On elimination, move the eliminated player's hand, resources, and defense cards to the graveyard, and discard their leaders.
9. **Match timing:** no turn timer; a disconnected player keeps their turn. A rejoined player resumes from the persisted state. Do not auto-skip a player without an explicit later rules decision.

These rulings resolve material gaps (especially deck size, event timing, shield durability, and turn timeouts). The rules also do not explicitly say when a general defense is installed; this proposal lets a player deploy it during their main phase, after which it passively responds to attacks until depleted. If the owner wants strict fidelity to an external printed rulebook, these must be checked against it before coding the affected mechanics.

## Acceptance criteria for the first playable version

- Two browsers can create/join a room, see the same public match state, and see different private hands.
- A match can complete setup, every phase, one representative card interaction from each card family, an elimination, and a winner state.
- Illegal commands (wrong player/phase, unavailable card, unmet sacrifice, invalid target, stale action ID) never mutate persisted state.
- A room survives a Worker isolate restart and a connected player can refresh/reconnect and continue.
- Repeated submissions do not double-spend cards or apply damage twice.
- Arabic RTL layout works on phone and desktop widths.
- Local development runs using the Workers-compatible Vite plugin; deployment needs only free-tier setup and a `workers.dev` hostname.

## Approval request

Approve the architecture and the nine provisional rulings above, or identify the rulings to change before implementation. The proposed remote name/visibility is `Lord-shaban/invasion-arena-online`, public. No repo or application code has been created yet; after approval, the next deliverable will be the implementation plan and then the standalone repository.

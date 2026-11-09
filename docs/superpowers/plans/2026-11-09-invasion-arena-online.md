# Invasion Arena Online Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete browser-based multiplayer version of Invasion | Civil War with server-authoritative rules, private player state, reconnect support, and free-tier deployment.

**Architecture:** A React/TypeScript/Vite client is served as static assets by one Cloudflare Worker. The Worker routes each room to one SQLite-backed Durable Object, which validates commands, applies the pure TypeScript game engine, persists state, and broadcasts per-player WebSocket snapshots.

**Tech Stack:** TypeScript, React, Vite, Cloudflare Workers, SQLite Durable Objects, WebSocket Hibernation API, Wrangler.

**Spec:** [../specs/2026-11-09-invasion-arena-online-design.md](../specs/2026-11-09-invasion-arena-online-design.md)

## Global Constraints

- Keep the original Arena OS site untouched; create a standalone `invasion-arena-online/` Git repository.
- Use a public remote named `Lord-shaban/invasion-arena-online` if the authenticated GitHub account can create it.
- Do not use paid services, require a billing account, or switch to a paid plan.
- Keep all authoritative state and card privacy on the server; clients submit commands only.
- Persist important room state in SQLite; do not rely on in-memory state surviving hibernation or deploys.
- Implement the approved `ruleset-v1` provisional rulings from the design document.
- Do not add or run automated tests unless requested; build and local preview commands are allowed for integration checks.

## Review Focus

- Private cards leaking in another player's snapshot — check the `viewForPlayer` projection and inspect serialized public/private messages.
- Concurrent or duplicate commands spending a card twice — check sequence and idempotency handling in the room command path.
- Commands from the wrong player/turn/phase mutating state — check validation before transition persistence.
- Hibernation or a deploy dropping game state — check storage commits and state reconstruction on object initialization.
- A legal card having impossible or partially-paid costs — check all costs before applying any mutation.

## File Structure

- `src/game/model.ts` — room/match/player/card/action/event types.
- `src/game/cards.ts` — typed definitions for the source's 37 card types.
- `src/game/rules.ts` — approved deck counts, phases, stage track, and ruleset version.
- `src/game/engine.ts` — pure transitions and action validation.
- `src/game/visibility.ts` — public and per-player snapshot projection.
- `src/worker/index.ts` — static asset fallback and room API routing.
- `src/worker/room.ts` — SQLite-backed per-room Durable Object and WebSocket lifecycle.
- `src/worker/protocol.ts` — validated client commands and server messages.
- `src/worker/identity.ts` — room-scoped rejoin tokens and token hashing.
- `src/client/api.ts` — HTTP/WebSocket client and reconnect handling.
- `src/client/App.tsx` — room creation/join flow and screen routing.
- `src/client/components/*` — lobby, turn controls, table/board, cards, pending defense, and result screens.
- `src/client/styles.css` — Arabic RTL responsive game styling.
- `public/cards/*` — 37 card images copied into the standalone repository.
- `wrangler.jsonc`, `vite.config.ts`, `package.json` — Worker binding, Vite integration, and project scripts.
- `README.md` — local setup, game flow, free deployment setup, and quota limits.

---

### Task 1: Create the standalone Worker + React repository

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`, `index.html`, `src/worker/index.ts`, `README.md`, `.gitignore`
- Initialize: `invasion-arena-online/.git`
- Remote: `https://github.com/Lord-shaban/invasion-arena-online.git` when available

**Interfaces:**
- Worker exports a default fetch handler using the Vite plugin's Cloudflare runtime.
- Wrangler binds `ROOMS` to `Room` and declares the first SQLite class migration.

- [ ] Scaffold React + TypeScript + Vite using Cloudflare's official Workers Vite integration.
- [ ] Add Worker binding and SQLite Durable Object migration; keep API and assets in one deployment.
- [ ] Initialize a local Git repository and create the public GitHub remote if account access permits.
- [ ] Add a short README with local commands and the current free-tier caveat.
- [ ] Run the production build and local Worker preview; confirm the shell page and `/api/health` respond.

### Task 2: Port cards and implement the deterministic game engine

**Files:**
- Create: `src/game/model.ts`, `src/game/cards.ts`, `src/game/rules.ts`, `src/game/engine.ts`, `src/game/visibility.ts`
- Source: `../assets/js/data.js` and the approved design's `ruleset-v1` rulings

**Interfaces:**
- `createMatch(roomId: string, players: Player[], seed: string): MatchState`
- `applyCommand(state: MatchState, playerId: string, command: GameCommand): TransitionResult`
- `viewForPlayer(state: MatchState, playerId: string): PlayerSnapshot`
- `viewPublic(state: MatchState): PublicSnapshot`
- `TransitionResult` is either `{ ok: true; state: MatchState; events: GameEvent[] }` or `{ ok: false; reason: RuleErrorCode }`.

- [ ] Port all 37 card definitions, preserving printed names, numeric effects, counters, and skill costs.
- [ ] Declare 2–5 seats, ten unique leaders, the 71-card shared deck, five fixed stage events, and ruleset version.
- [ ] Model room lifecycle, match status, turn phases, player HP/elimination, private hand/resources, public defenses, pending attacks, and sequence number.
- [ ] Implement seeded shuffling and match setup with two unique leaders per player, five-card hands, 6,000 HP, and a first player.
- [ ] Implement draw/main/battle/end progression, five stage transitions, and their approved global effects.
- [ ] Implement resource deployment/payment, once-per-match leader skills, attack types, defense rules, support combos, traps, elimination, deck recycling, and winner detection.
- [ ] Validate every command completely before mutation; make duplicate command IDs idempotent.
- [ ] Implement per-player projections so hidden opponent hands and resource identities never leave the server.
- [ ] Run TypeScript type checking and production build; inspect that private snapshot fields are omitted from public serialization.

### Task 3: Add persistent room authority and WebSocket protocol

**Files:**
- Create: `src/worker/room.ts`, `src/worker/protocol.ts`, `src/worker/identity.ts`
- Modify: `src/worker/index.ts`, `wrangler.jsonc`

**Interfaces:**
- `POST /api/rooms` creates a lobby and returns `roomCode`, `playerId`, `rejoinSecret`, and snapshot.
- `POST /api/rooms/:code/join` joins a lobby using `displayName` and returns the same credentials.
- `POST /api/rooms/:code/start` starts a host-owned match.
- `GET /api/rooms/:code/socket` upgrades to a pending WebSocket; its first client message carries the rejoin secret and no snapshot is sent before validation.
- Client messages are `command` envelopes with `{ actionId, expectedSeq, command }` or `resync`; server messages are `{ type: "snapshot", seq, public, private }` or `{ type: "rejected", actionId, reason, seq }`.

- [ ] Validate room codes, names, HTTP methods, JSON types, message size, and action envelope fields.
- [ ] Create/join lobby and enforce host-only start with 2–5 seats and unique participant IDs.
- [ ] Store room/match state, sequence, and event log in the Durable Object SQLite store; reconstruct state after initialization.
- [ ] Generate cryptographically random room-scoped rejoin secrets, store hashes only, and attach player identity to each accepted WebSocket.
- [ ] Use hibernatable WebSocket handlers, verify a first-frame rejoin-secret handshake, and restore identity after hibernation from serialized attachment metadata.
- [ ] Route each command through the pure engine, persist before acknowledging, and broadcast public plus recipient-private snapshots.
- [ ] Reject stale/duplicate commands without reapplying effects; send an authorized snapshot after reconnect/resync.
- [ ] Run local Worker preview and inspect HTTP and socket protocol behavior with two local clients.

### Task 4: Build the complete Arabic game client

**Files:**
- Create: `src/client/api.ts`, `src/client/App.tsx`, `src/client/components/*`, `src/client/styles.css`
- Modify: `index.html`

**Interfaces:**
- The client stores only room credentials and the most recent authorized snapshot.
- All mutations use the protocol's command envelope; the client never computes final HP, ownership, costs, or game winner.

- [ ] Build a home screen to create/join by room code and choose a display name.
- [ ] Build a lobby with player list, readiness/status, host start action, and rejoin affordance.
- [ ] Build the match table: turn order, HP, current stage, zones, public defenses, own hand, and own face-down resources.
- [ ] Copy the 37 existing card images into `public/cards/` so the project remains self-contained.
- [ ] Show turn phase and only the actions available to the local player; keep card identities of opponents hidden.
- [ ] Show pending attacks to the correct target, list valid response cards, and wait for the server's result.
- [ ] Show clear card detail text and costs for all 37 types, effect/rejection messages, disconnect/reconnect state, elimination, and winner.
- [ ] Apply Arabic RTL and responsive phone/desktop layout with keyboard-visible controls and readable HP/phase status.
- [ ] Run a production build and local preview; manually follow the room-to-winner flow in two browser sessions without adding an automated test suite.

### Task 5: Document setup and deploy the first public build

**Files:**
- Modify: `README.md`, `wrangler.jsonc`, `package.json`
- Remote: `Lord-shaban/invasion-arena-online`

**Interfaces:**
- `npm run dev` runs the Worker-compatible Vite development environment.
- `npm run build` creates the production assets and Worker bundle.
- `npm run deploy` deploys to the linked Cloudflare account.

- [ ] Document Node requirements, local commands, room protocol summary, approved rulings, and free-tier limits.
- [ ] Add deployment steps that do not require a paid Cloudflare plan or billing account.
- [ ] Deploy only if an authenticated Cloudflare account is available; otherwise leave a ready-to-deploy project and exact setup commands.
- [ ] Record the final remote URL and live `workers.dev` URL if deployment succeeds.

## Execution Notes

- Use `superpowers:executing-plans` to execute tasks sequentially.
- Do not commit or push secrets, room tokens, Cloudflare credentials, or `.dev.vars`.
- If GitHub or Cloudflare account authorization is unavailable, finish the local repository and report the single account action needed rather than inventing credentials.

# Online Match Disconnect/Reconnect Analysis

## Current behavior in `index.html`

### 1) Match identity and game record ownership
- The game record is created at `games/<hostPlayerId>`.
- The host waits on `games/<hostPlayerId>` and the guest writes into that path when matched.
- During the game, both sides use `currentGameId = hostId`, so the path remains host-owned for the whole match.

### 2) Presence tracking while in-game
- When online play starts, each player writes `games/<gameId>/presence/<playerId> = { online: true }`.
- A Firebase `onDisconnect()` handler flips their presence to `{ online: false, disconnectedAt: <server timestamp> }` if the socket drops.

### 3) What happens when opponent disconnects
- The local client listens to `presence/<opponentId>`.
- If opponent becomes offline, a local 30s timer starts and UI shows: "Opponent disconnected — waiting 30s for reconnect..."
- If opponent comes back online before 30s, timer is cancelled.
- If not, local client declares game over as `result.type = "abandon"` and sets winner to the current player.

### 4) Cleanup behavior is currently destructive for reconnect
- `cleanupGame()` marks the current player offline (`presence/<currentPlayerId> = { online:false, leftAt:Date.now() }`).
- `cleanupGame()` sets `gameRef = null` and clears local game context.
- `beforeunload` forcibly records an `abandon` game result before cleanup.

### 5) Why true reconnect does not exist today
- There is no persisted "active game pointer" on the player profile (e.g. `players/<id>/activeGameId`).
- No login/bootstrap flow checks for unfinished games and offers "Resume".
- Unload currently finalizes the game as abandon, ending the match state, so there is often nothing left to resume.

---

## Options for adding reconnect support

## Option A — Soft reconnect window (minimal change, safest first step)

### Idea
Keep match alive for a grace period (e.g. 30-60s) when a player disconnects. Do **not** finalize game on `beforeunload` immediately.

### Required changes
1. Remove (or gate) the forced-abandon write in `beforeunload`.
2. Store disconnect deadline in Firebase game state, not only local timeout, e.g.:
   - `games/<id>/disconnectState = { playerId, disconnectedAt, forfeitAt }`
3. Run a shared timeout decision from authoritative data:
   - either via one "arbiter" client rule,
   - or preferably via backend function/transaction if available.
4. If player reconnects before `forfeitAt`, clear disconnect state and continue.

### Pros
- Minimal schema changes.
- Aligns with your current 30s logic.
- Preserves current UX with better fairness.

### Cons / risks
- Without server arbitration, both clients may race to set final result.
- Requires careful idempotency around result recording.

---

## Option B — Full session resume after page reload/tab close (recommended)

### Idea
Persist active match ownership so a returning player can re-attach to `games/<id>` and continue.

### Required changes
1. Add active-game pointer per player:
   - `players/<playerId>/activeGameId = <gameId>` while game is active.
2. On login/start screen init, check for active game:
   - if game exists and `state.gameOver !== true`, show **Resume Game** CTA.
3. Implement `resumeOnlineGame(gameId)`:
   - Load game document,
   - infer player color from `host.id` / `guest.id`,
   - rebuild `currentPlayer`, `opponent`, `gameState`,
   - re-register presence and listeners,
   - route to game screen.
4. On legitimate game completion, clear both players' `activeGameId`.
5. Distinguish voluntary resign/home from accidental disconnect:
   - only set abandon on explicit resign/timeout policy, not browser unload.

### Pros
- Handles real reconnect scenarios (refresh, browser crash, transient network loss).
- Better user expectation for "ongoing match".
- Compatible with competition timer logic already embedded in game state.

### Cons / risks
- Medium implementation complexity.
- Needs robust ownership/authorization rules to prevent unauthorized resume.

---

## Option C — Rejoin tokens for strict session integrity (advanced)

### Idea
Issue per-player ephemeral rejoin token at match start; require token to reattach.

### Required changes
- Store token hash in game record.
- Keep plaintext token in local storage/session storage.
- Validate on resume before allowing presence update.

### Pros
- Stronger protection against account switching/shared devices.

### Cons
- Heavier UX and implementation complexity.
- Usually unnecessary for school chess unless cheating/session hijack is a major concern.

---

## Option D — "Disconnect = immediate forfeit" (current-ish policy)

### Idea
Keep simple, no reconnect support.

### Notes
- This is effectively today's behavior because unload often writes abandon instantly.
- Fast and simple but poor reliability on unstable networks.

---

## Suggested direction

1. **First:** implement Option A policy fix (remove forced unload-abandon and make grace period authoritative in DB).
2. **Second:** implement Option B resume flow (`activeGameId` + Resume CTA).
3. **Later (optional):** harden with token-based Option C only if abuse appears.

This phased approach gives quick reliability gains without a large rewrite, then adds proper "resume match" UX once base state handling is stable.

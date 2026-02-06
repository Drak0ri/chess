# Repository Discovery Notes

## What this project appears to be

This repository looks like the beginning of a **Firebase-backed, browser-only student chess app** intended for lightweight deployment (likely GitHub Pages) with no custom backend.

Core flow:
1. `index.html`: username/password auth UI (implemented via Firebase Email/Password using a generated email format).
2. `lobby.html`: online user list, player challenges, and game/challenge overview.
3. `game.html`: real-time chess board synced through Firebase Realtime Database.

## Current state

The basic product skeleton is in place and mostly wired:
- Auth create/login flow exists.
- User records and online presence are persisted.
- Challenge creation/acceptance exists.
- Game state stores FEN + turn and updates in real time.
- Win/loss/draw counters are being tracked.

## Why it feels "broken"

A few signs indicate this is an in-progress prototype:

1. **Placeholder Firebase config in all pages**
   - The app will not run until `firebaseConfig` is replaced in `index.html`, `lobby.html`, and `game.html`.

2. **Runtime bug in lobby challenge acceptance**
   - `acceptChallenge()` uses `get(...)` but `get` is not imported from `firebase-database`, causing a ReferenceError when accepting a challenge.

3. **Unfinished lobby game listing path**
   - `listenForGames()` subscribes to `/games` but does not render anything yet (comment placeholder).

4. **MVP-level rule handling and UX**
   - Draw offer is immediate acceptance.
   - No anti-cheat or authoritative server validation.
   - Database rules in README are broad and marked as setup guidance.

## What you were likely starting

You were likely building an **MVP for a school chess arena** with:
- lightweight account system,
- live lobby/challenge flow,
- simple real-time game sync,
- and basic student stats,

optimized for quick setup and Chromebook/browser compatibility.

## Suggested next steps

1. Replace Firebase config in all 3 pages.
2. Fix missing `get` import in `lobby.html`.
3. Finish game rendering in lobby (`listenForGames`).
4. Harden database security rules and verify auth-domain restrictions.
5. Add guardrails around stat updates to avoid duplicate increments.

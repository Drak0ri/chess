# IES Chess Portal — Alpha 2.0 Snapshot

_Date:_ 2026-02-17  
_Branch:_ `work`

## 1) Current product snapshot

The repository has evolved into a **multi-page Firebase-powered chess portal** with six major user-facing surfaces:

- `index.html` — core play experience (student + competition play flow).
- `puzzles.html` — tactical puzzle mode with rating progression and puzzle stats.
- `leaderboard.html` — global and competition leaderboards.
- `comp.html` — competition listing, state display, and join entry point.
- `chess_news.html` — announcement/news feed.
- `admin.html` — full admin control center (schools, competitions, approvals, settings, appearance, content).

This is a meaningful jump from a basic single-page alpha; the repo now resembles a **small production portal** with operations tooling.

## 2) Scale and complexity indicators

Quick static metrics from current files:

| File | Lines | `db.ref(...)` uses | Realtime listeners (`.on('value'`) | `innerHTML =` assignments |
|---|---:|---:|---:|---:|
| `index.html` | 613 | 12 | 7 | 15 |
| `admin.html` | 2540 | 45 | 11 | 22 |
| `leaderboard.html` | 530 | 4 | 4 | 5 |
| `puzzles.html` | 1114 | 5 | 4 | 11 |
| `chess_news.html` | 99 | 1 | 1 | 2 |
| `comp.html` | 141 | 2 | 2 | 2 |

Interpretation:
- `admin.html` is currently a **monolith** and the largest concentration of business logic.
- The app architecture is **frontend-heavy with direct DB coupling**.
- Significant dynamic DOM rendering exists; maintainability and safety now matter more than speed of iteration.

## 3) What is working well (strengths)

1. **Feature breadth is strong for an alpha**: gameplay, puzzles, leaderboarding, competition operations, and editorial updates are all present.
2. **Realtime data model is consistent** across pages via Firebase Realtime Database listeners.
3. **Admin tooling is not superficial** — includes role handling, approvals, settings, appearance customization, competitions, and news workflow.
4. **Design consistency** appears intentional (shared dark theme styling and navigation patterns).
5. **Defensive output encoding exists in places** (for example in competition rendering), showing awareness of XSS risk.

## 4) Issues & risks you should address next

### A. Architecture / maintainability risk
- Most pages are large single-file HTML+CSS+JS documents, and `admin.html` is especially large.
- This increases regression risk, onboarding time, and “change blast radius.”

**Recommendation:**
- Begin modularization (even without a framework): extract shared JS modules, shared CSS, and common Firebase bootstrapping.
- First target: split `admin.html` into domain modules (`schools`, `competitions`, `news`, `access`, `appearance`, `settings`).

### B. Repeated Firebase bootstrap and config drift risk
- Firebase script imports and config are repeated per page.
- If a key/path changes, updates must be manually synchronized.

**Recommendation:**
- Introduce a shared `js/firebase.js` and `js/config.js` with a single initialization guard.
- Reuse a `getDb()` helper across pages.

### C. Security posture (frontend-authoritative patterns)
- The client performs many direct writes to administrative paths.
- If Firebase security rules are not strict server-side, privilege escalation risk is high.

**Recommendation:**
- Validate that Firebase Rules strictly enforce role-based access.
- Move sensitive operations to Cloud Functions (`approve/revoke admin`, settings writes, potentially competition lifecycle writes).
- Add write-path audit logging (`who`, `when`, `what changed`).

### D. Rendering safety consistency
- There is extensive `innerHTML` usage across pages.
- Some contexts already sanitize output, but consistency is hard in current structure.

**Recommendation:**
- Adopt one central escaped-template utility and use it everywhere.
- Prefer `textContent` + DOM creation for untrusted data.
- Add a lightweight lint/check that flags unsanitized `innerHTML` on user-controlled fields.

### E. Reliability / performance concerns
- Heavy use of broad realtime listeners can over-fetch and increase render churn.
- Timers and repeated renders can become expensive with scale.

**Recommendation:**
- Use query-scoped reads where possible.
- Debounce expensive render paths.
- Add manual unsubscribe patterns for temporary views/modals.

### F. Testability gap
- No dedicated test suite appears in this repo snapshot.

**Recommendation:**
- Add a minimal test harness:
  - pure utility tests (rating math, competition status state machine, tie-break logic);
  - smoke E2E (login -> start game -> save match; admin create competition; publish news).

## 5) High-value feature opportunities (what you might add next)

### Product features
1. **Player profiles + match history page** (personal progress narrative).
2. **Season system** (monthly/term resets, archived standings).
3. **Competition brackets + Swiss pairing support** (depending on format).
4. **Puzzle curriculum paths** (opening motifs, tactics themes, difficulty tracks).
5. **School-vs-school dashboard** (engagement and performance analytics).
6. **Moderation/report tools** for inappropriate names/content.
7. **In-app notifications** (competition starting soon, approval status, new news post).

### Operational features
1. **Admin audit log UI**.
2. **Data export/backup controls** (CSV/JSON by school/period).
3. **Feature flags** for rolling out experimental modes safely.

## 6) Suggested upgrade roadmap

### Phase 1 (stability hardening, 1–2 weeks)
- Create shared firebase/config/bootstrap modules.
- Extract shared UI primitives (nav/header/theme tokens).
- Add centralized sanitize/render helpers.
- Add Firebase Rules review checklist and patch gaps.

### Phase 2 (quality and guardrails, 1–2 weeks)
- Add unit tests for business logic utilities.
- Add smoke Playwright tests for core journeys.
- Add CI checks (lint + test + basic static validation).

### Phase 3 (capability expansion, 2–4 weeks)
- Deliver player profile/history and seasonal leaderboarding.
- Add admin audit trails and export features.
- Introduce Cloud Functions for privileged workflows.

## 7) Release framing recommendation

Naming this snapshot **Alpha 2.0** is justified: the project now includes core gameplay plus content, competition management, and administrative governance workflows. The biggest shift needed for the next milestone is not feature count — it is **engineering maturity** (modularity, security enforcement, and test coverage).

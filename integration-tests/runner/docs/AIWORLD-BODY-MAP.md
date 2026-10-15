# AI World — BODY Layer Map (`lib/village/`)

> Factual audit (2026-08-18). Code is truth; docs noted where STALE.

## 1. Per-file purpose
| File | Purpose |
|---|---|
| `walk.js` | Locomotion. Primary: server-side `walk_path` A* (3.89 b/s, no teleport when `allowTeleport:false`). Fallback: node stepping loop (bot-like, deprecated). Stage-4: recovery teleport only if `allowTeleport`. |
| `job-runner.js` | Incremental job executor. `runJobStep` runs one step (walk/break/place/gather/craft) with a `CAN_WORK` guard driven by `inspectBody`. |
| `terrain.js` | `findSurfaceY` / `isAirish` — surface probing. **DEPENDS on `execute if block` which is BROKEN on CivsTestHarness (always "Test passed")** → unreliable. Not used in spawn path anymore (Fase 1). |
| `focus.js` | `chooseFocus` — maps survival state + worldMemory → `focus` (survive/build/maintain/...). Consumes `assessment.worldMemory`. |
| `objective-plan.js` | `planObjective` — RPG objective → capability intents. |
| `jobs.js` | Job definitions (miner/lumberjack/gather/farmer/builder/torch/...). |
| `construction/` | Blueprint/engine/validate/repair for building jobs. |

## 2. The per-tick OBJECTIVE/WAYPOINT SELECTOR (where "Steve walks in circles" lives)
- **`chooseObjective`** in `scripts/village-worker.js` (~line 1644-1708): picks `job` + `focus` from `LOOP` rotation or focus→job map. **This is the brain-side focus selection, NOT the (x,z) waypoint.**
- **The concrete (x,z) for each job** comes from `SITES` / `siteForJob` in `lib/village/` (referenced in AIWORLD-AUDIT.md 1.3). The job's `step` carries `to: {x,y,z}` (e.g. `walk to {x:5194,y:82,z:5181}`).
- **Waypoint selection failure** (circuit): when `walk_path` stalls on an unreachable waypoint (under-platform, needs climb), the job re-issues the same `step.to` → loop. The `execute.js` recover/retreat path was the old safety valve (now removed in Fase 1.5).
- **Anti-stall:** `lib/ai-world/intention-cache.js` `AntiStall` ladder (CONTINUE→LOCAL_RECOVERY→REPLAN→CONSULT_LLM→ABANDON_GOAL) exists but is wired to the BRAIN focus, not the BODY waypoint re-issue. **GAP:** the BODY selector does not consult `invalidatedPlans` (anti-stupid.js) to avoid re-selecting a stuck waypoint. See GAPS below.

## 3. walk.js teleport status (CURRENT)
- `cap.teleport` calls in `lib/village/walk.js`:
  - Line 341: `if (allowTeleport)` — closes gap for goals beyond `recoverDistance` (legacy). **Not hit** because worker passes `allowTeleport:false`.
  - Line 533: Stage-4 last-resort `cap.teleport(goal)` — `if (allowTeleport && !recoverTeleport)`. **Not hit** with `allowTeleport:false`.
- **Result:** no teleport in work-path today. Locomotion = `walk_path` A* only (or B3 hop-walk when out of range, also no-teleport).

## 4. inspectBody (job-runner.js) — CURRENT
Uses `harness.cap.observe()` (NOT `execute if block`):
```js
const onGround = d.on_ground === true;
const below = String(d.block_below || '').toUpperCase();
const feet = String(d.block_feet || '').toUpperCase();
const supportSolid = below !== '' && below !== 'AIR' && below !== 'CAVE_AIR' && below !== 'VOID_AIR';
const feetClear = feet === '' || feet === 'AIR' || feet === 'CAVE_AIR' || feet === 'VOID_AIR';
const standable = onGround || (supportSolid && feetClear);
```
- `CAN_WORK` guard in `runJobStep` blocks break/place/gather/craft when `!standable` → returns RECOVERY. This killed the "terraform in air" bug.

## 5. GAPS (doc vs real code)
| Doc claim (AIWORLD-COORD.md / BRAIN-CONTRACT.md) | Real code | Status |
|---|---|---|
| "retreat teleport-home is approved (D-AP-021)" | `returnTeleport` REMOVED in Fase 1.5 (1da7ce79) | **STALE doc** — user reversed this |
| "bug is objective re-issuing unreachable waypoint, not teleport" | True, but BODY selector does NOT consult `invalidatedPlans` | **GAP** — waypoint re-issue loop unfixed |
| "anti-stupid invalidates plan on retry_budget_exhausted" | `invalidatedPlans` exists in anti-stupid.js but BODY selector doesn't read it | **GAP** |
| "navigation primitive (walk_path) is NOT the problem" | Confirmed: walk_path 3.89 b/s, 0% stalled | **Valid** |

## 6. (C) WASD reality (capabilities.js)
- Exposed: `sneak` (100), `sprint` (103), `jump` (106), `step forward <len>` (145). **No `back`/`left`/`right`.**
- `step` is discrete, not continuous WASD.
- `walk.js` line 5-9: stepping loop tested, rejected as bot-like (0.75 b/s, 76.5% stationary).
- **Conclusion:** full WASD not possible via CivsTestHarness `act`. Max = forward+jump+sneak+sprint stepping, which is worse than `walk_path`. Real WASD needs Mineflayer (blocked on 26.1.2) or server downgrade to 1.21.x.

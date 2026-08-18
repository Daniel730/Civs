# AI World — WORKER Map (`scripts/village-worker.js`)

> Factual audit (2026-08-18). Code is truth.

## 1. main() startup sequence
1. `loadState()` (1715) — restore persisted state (origin, loopIdx, objectiveProgress).
2. `Harness` init (1718) — ports from `cfg` (RCON 25576, MC 25566, lines 159-167).
3. `adjustOriginToSurface(harness, cfg)` (1733) — **Fase 1: now NO-OP** (returns cfg.origin; does not call broken `findSurfaceY`). See commit efb4f9e1.
4. `connectActor(harness, cfg.actorName)` (1735) — **Fase 1: NO spawn teleport** (removed). Steve stays where server placed him.
5. `continuity_origin` block (1742-1763) — adopts Steve's REAL position via `harness.cap.observe()` into `cfg.origin`. Runs AFTER connectActor. **This is the player-like spawn: origin = wherever Steve actually is.**
6. `setInterval(tick, cfg.intervalMs)` — the live loop.

## 2. connectActor — spawn teleport REMOVED
- Before Fase 1: `await actor.teleport(cfg.origin.x, standY, cfg.origin.z)` + `findSurfaceY` climb loop.
- After Fase 1 (efb4f9e1): removed. `connectActor` only does `grantOp()` + `ensureAlive()`. Steve spawns naturally.
- git: `git log --oneline -1 -- scripts/village-worker.js` → `efb4f9e1 Fase 1: kill spawn teleport...`

## 3. continuity_origin (1742-1763) — CURRENT
```js
const posRes = await harness.cap.observe(cfg.actorName);
const od = (posRes && posRes.data) || {};
if (Number.isFinite(od.x) && Number.isFinite(od.y) && Number.isFinite(od.z)) {
  cfg.origin = { x: Math.floor(od.x), y: Math.floor(od.y), z: Math.floor(od.z) };
  state.lastObservedPos = cfg.origin;
  ...
}
```
Adopts real position. Runs after connectActor.

## 4. tick() — resilience P2
- `tick` (~line 2008) calls `await harness.ensureConnected()` at start (added in P2 commit fb45df40). If RCON dropped, it reconnects; if fails, logs `WARN reconnecting` and returns early (no crash).
- P2 fixed the worker dying on `Buffer.from(undefined)` when RCON oscillated.

## 5. inspectBody usage
- `job-runner.js runJobStep` calls `inspectBody(harness, actorName)`.
- If `!body.standable` → step returns `{ ok:false, reason:'actor_not_physically_valid' }` → RECOVERY (no edit/break/place). This is the CAN_WORK guard.

## 6. Recently applied patches (git log)
| Commit | Summary |
|---|---|
| `efb4f9e1` | Fase 1: kill spawn teleport + inspectBody uses observe (not broken execute if block) |
| `391c0931` | self-train: fix trainer crash (weights undefined in aiworld-train.js) |
| `1da7ce79` | Fase 1.5: remove returnTeleport after respawn (survival recover) |
| `f5f49ad0` | test: update recover spec — no returnTeleport |
| `fb45df40` | P2: harness.raw resilient + tick ensureConnected (RCON reconnect) |
| `263ffb6d` | P0.1 CAN_WORK guard in job-runner.runJobStep |
| `5e02d6ab` | P0.2 relax + flee C-FIX (drown loop) |
| `50493f02` | B1 safeWalk + B2 walk_path_hops |
| `df256fa6` | C findNearestDryLand + flee caller adopts safePoint |

## 7. ENV vars (grep process.env)
- `RCON_HOST` (default 192.168.152.149), `RCON_PORT` (default **25576**), `RCON_PASSWORD` (civsqa).
- `MC_HOST` (192.168.152.149), `MC_PORT` (default **25566**).
- `VILLAGE_X/Y/Z` (5200/80/5200 — **points to OCEAN in fresh world; should be ignored in favor of continuity_origin**).
- `SURFACE_FALLBACK` (1), `DETERMINISTIC_MODE` (1), `AIWORLD_POLICY` (ollama/neural/deterministic), `AIWORLD_SELFTRAIN` (1), `AIWORLD_NO_EQUIP` (1).

## 8. STALE notes
- AIWORLD-STATUS.md says RCON 25575 / MC 25565 — WRONG, code uses 25576/25566.
- AIWORLD-STATUS.md says suite `npm run test:nightshift-unit` 131/131 — NOW `npm run test:unit` 368/368.
- AIWORLD-COORD.md / BRAIN-CONTRACT.md say teleport-home approved (D-AP-021) — REVERSED in Fase 1.5.

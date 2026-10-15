# AI World — SURVIVAL / ACTOR / HARNESS Map

> Factual audit (2026-08-18). Code is truth; docs noted where STALE.

## 1. execute.js — every `cap.teleport` (CURRENT)
| Line | Survival kind | Notes |
|---|---|---|
| 89 (REMOVED in Fase 1.5) | `recover` returnTeleport | **Was:** teleport to `origin` after respawn. **Now:** removed — Steve adopts server spawn via continuity_origin. |
| 151 | `flee` land | Teleport to dry land when drowning (last-resort). |
| 159 | `flee` up | Teleport up when submerged (last-resort). |
| 202, 275, 300 | `retreat`/home | Teleport-home on stalled walk_path (legacy `allowTeleport` path). |

**D-AP-021 status:** AIWORLD-COORD.md / BRAIN-CONTRACT.md call retreat teleport-home "approved architecture". **The user REVERSED this in Fase 1.5** (removed `returnTeleport`). Those docs are STALE on this point. The remaining flee/retreat teleports (151/159/202/275/300) are last-resort survival egress — NOT locomotion — and were not removed (user only objected to spawn + return-to-base teleports).

## 2. returnTeleport removal — git proof
```bash
git show HEAD~1:lib/survival/execute.js | grep -n returnTeleport   # shows the old block
git log --oneline -3 -- lib/survival/execute.js
# 1da7ce79 Fase 1.5: remove returnTeleport after respawn (survival recover)
# f5f49ad0 test: update recover spec — no returnTeleport
```
Removing it does NOT violate D-AP-021 *as currently practiced* — the user explicitly chose "no teleport" over the approved teleport-home. The doc is stale, not the code.

## 3. actor.js — RawKeepAliveActor
- A `minecraft-protocol` client (not Mineflayer) that logs in as the NPC (Steve) and stays online.
- Does NOT teleport directly; the worker issues teleports via `harness.cap.teleport`.
- Relationship: `harness.js` wraps RCON (admin commands: `test act`, `test observe`, `cv`, `tp`). `actor.js` is the *player session*; `harness` is the *admin channel*. Both talk to the same MC server. The worker uses `harness` for almost everything (observe/act/teleport); `actor.js` mostly keeps the session alive + grants op.

## 4. harness.js — RCON wrapper
- Hardcoded connection (line 54): `{ host: '127.0.0.1', port: 25576, password: 'civsqa', ... }`. **Note:** host is `127.0.0.1` here but worker overrides with `cfg.rconHost` (192.168.152.149). Port 25576 = CORRECT (not 25575).
- Wraps: `raw(cmd)` (RCON send+recv), `connect()`, `ensureConnected()` (reconnect, P2 resilience), `cap` (Capabilities).
- `execute if block` probe: **BROKEN on CivsTestHarness** — always returns "Test passed" (verified 2026-08-18 via read-only RCON test). Any code relying on it (`terrain.findSurfaceY`, old `inspectBody`) is unreliable. `inspectBody` now uses `observe` instead.

## 5. actor-mineflayer.js — CURRENT (tested 2026-08-18)
- `patchVersionGate('26.1.2')` pushes '26.1.2' into `mineflayer/lib/version.js.testedVersions` + sets `latestSupportedVersion`.
- `createBot({ host, port, username:'Steve', auth:'offline', version:'26.1.2', skipValidation:true })`.
- **Result:** `createBot` throws `Server version '26.1' is not supported. Latest supported version is '1.21.11'.` → `available:false`.
- Mineflayer 4.37.1 + minecraft-protocol 1.66.2 do NOT support MC 26.1.2. WASD/física real blocked here.

## 6. (C) WASD via CivsTestHarness — see AIWORLD-BODY-MAP.md §6
Not full WASD; stepping already rejected as bot-like.

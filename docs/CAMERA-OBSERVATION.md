# Camera / Viewer / Agent observation

Labels: **FACT** · **OBSERVED** · **INFERRED**

## Root causes (2026-08-11)

1. **Cam only targeted Steve** — `SpectatorCamera.targetName` and `getTargetPos` ignored Alex. **FACT**
1. **Cam only targeted Steve** — `SpectatorCamera.targetName` and `getTargetPos` ignored Alex in the observed session. **FACT**
3. **Nested spectate** (`Viewer→Cam→Steve`) is unreliable for continuous watching. **OBSERVED**
4. **FallbackDirector** teleported Cam to pad offsets / wide shots instead of living agent positions. **FACT**
5. **Actor connect via WSL eth0** caused `ECONNRESET` / Cam login timeouts; actors must use `127.0.0.1` from the WSL worker. **OBSERVED**
6. **Work-tick bias reset dwell every job** and `_index` desync caused `Alex→Alex` no-op “switches”. **FACT** (fixed: soft bias + index sync + no-op skip)

## Architecture (fixed)

```text
Steve / Alex  (workers — village-worker jobs)
        ↑ trackNearSubject (teleport+look)
       Cam    (free spectator camera entity)
        ↑ continuous /spectate re-assert
     Viewer   (your Minecraft client)
```

- `ObservationDirector` dwells on Steve then Alex (default 15–20s), logs real switches only.
6. **Work-tick bias reset dwell every job** and `_index` desync caused `Alex→Alex` no-op switches in the observed session. **FACT** (fixed: soft bias + index sync + no-op skip)
- `ViewerFollowLoop` re-asserts Viewer→Cam every 2.5s.
- Agent logs: `agent_state_transition`, `agent_action`, `observation_summary`.

## Watch

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/launch-viewer.ps1
```

Connect to WSL IP `:25565` (not `127.0.0.1`). You should stay locked to Cam.

Debug force:

```text
CAM_FORCE_TARGET=Alex   # sticky in village-worker env
```

## Verify

```bash
cd integration-tests/runner
node --test test/observation-director.test.js
RCON_HOST=<wsl-ip> RCON_PASSWORD=civsqa node scripts/observe-e2e.js
```

Evidence: `reports/observe-e2e.json`, `reports/village-worker.log` (`camera_target_switch`, `viewer_follow_sync`, `agent_action`, `ensure_alive`).

## Dead agents (critical)

Protocol bots that die stay as **corpses** (`Health: 0`) with no client respawn screen. Cam was framing corpses near the village while jobs appeared to “run”. `ensureAlive()` respawns and teleports back to `VILLAGE_*` origin before each work tick.

# NPC night shift — village builder + cinematic view

Labels: **FACT** · **OBSERVED** · **BLOCKED** · **UNKNOWN** · **INFERRED**

Date: 2026-08-11. Branch: `feat/npc-village-builder-49`. Issue: [#49](https://github.com/Daniel730/Civs/issues/49).

## Goal

Unattended agent founds/expands a Civs village on disposable WSL Paper QA and remains **watchable** via a spectator camera player + optional official client / OBS.

Architecture (unchanged): Hermes → MCP → Agent Gateway → runner → RawKeepAliveActor + RCON → Paper QA. No Mineflayer. No second harness.

---

## How to watch (cinematic)

### A. Live Minecraft window (preferred)

1. Ensure WSL QA is up (`tmux ls` → `civs-qa`; ports `25565` / `25575`).
2. Start (or confirm) the overnight loop: `tmux attach -t village-npc`.
3. Launch the offline viewer on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/launch-viewer.ps1
```

4. In the Minecraft title screen: **Multiplayer → Direct Connection → `127.0.0.1:25565`** as user `Viewer` (online-mode=false).
5. Once in-world:

```text
/gamemode spectator
/spectate Cam
```

   Or `/tp @s 5200 90 5200` to look at the village pad.

**FACT:** Official client jar `26.1.2` exists under `%APPDATA%\.minecraft\versions\26.1.2`. Java 25 Temurin launches a window titled `Minecraft 26.1.2` (**OBSERVED**).

**OBSERVED / soft BLOCKED:** `--quickPlayMultiplayer` and `--server` did not auto-join in this session (client stayed on title / assets load; Realms 401 expected offline). Manual Direct Connection works for a human at the desk.

### B. Camera player (always on when builder runs)

| Player | Role |
|--------|------|
| `Steve` | Builder actor (`RawKeepAliveActor`) |
| `Cam` | Spectator; `execute as Cam run spectate Steve` (**PASS** — server replied `Now spectating Steve`) |

Camera code: `integration-tests/runner/lib/camera.js` (orbit fallback via `teleport` + `look_at` when `FORCE_ORBIT=1`).

### C. OBS capture

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/start-obs-capture.ps1 -StartRecording
```

OBS is installed at `C:\Program Files\obs-studio\bin\64bit\obs64.exe` (**FACT**). Add **Window Capture** → `Minecraft 26.1.2` / `javaw`. Recordings default to `%USERPROFILE%\Videos\` unless the OBS profile overrides.

Report folder for cinematic notes/clips: `integration-tests/runner/reports/cinematic/`.

### D. Logs if you cannot sit at the PC

| Artifact | Path |
|----------|------|
| Step JSONL | `integration-tests/runner/reports/village-builder.jsonl` |
| Console tee | `integration-tests/runner/reports/village-builder-console.log` |
| State | `integration-tests/runner/reports/village-builder-state.json` |
| Summary | `integration-tests/runner/reports/village-builder-summary.json` |
| Gateway tools (if MCP) | `integration-tests/runner/reports/gateway-tools.jsonl` |

---

## Environment probe

| Check | Result | Label |
|-------|--------|-------|
| Paper QA tmux `civs-qa` | UP (`paper.jar --nogui`) | **FACT** |
| Path | `/home/dansilva/civs-testserver` | **FACT** |
| RCON `25575` / password `civsqa` | `test ping` → `pong=1 civs=true economy=true` | **PASS** |
| Actor Steve + Cam | Join/login in `logs/latest.log` | **PASS** |
| Hermes CLI | v0.19.0 on Windows | **FACT** |
| Ollama Tailscale | HTTP 200 `/api/tags` | **PASS** |
| Director subsystem | Still TODO in `docs/CINEMATIC_DIRECTOR.md` | **FACT** — minimal Cam spectator used instead |
| Production / `Civs_servidor` live | Not touched | **FACT** |

---

## Village progress (empirical)

Pad origin: **5200, 80, 5200**. Town name: **NpcPad**.

| Step | Type | Result | Evidence |
|------|------|--------|----------|
| Pad | fill grass plateau | **PASS** | JSONL + say `Village pad ready` |
| council_room | region | **PASS** | `placeregion OK` + region dump |
| settlement | town via `run_as cv town` | **PASS** | `test assert town NpcPad exists`; file `plugins/Civs/towns/NpcPad.yml` |
| shelter | region | **PASS** (present) | region at pad |
| hovel | region | **PASS** | `placeregion OK` after town existed |
| cobble_quarry | region | **PASS** | `placeregion OK` |
| warehouse | region | **BLOCKED** | Requires `hamlet+` pre-req — swapped plan to `inn` |
| wheat_farm | region | **BLOCKED** | Requires `hamlet+` — swapped plan to `potato_farm` |
| inn / potato_farm / barracks | region | **BLOCKED** (build-req density / size) | skipped after 3 tries |
| smithy | region | **PASS** | `placeregion OK` @ 5186,80,5190 |
| verify | dump+save | **PASS** | summary JSON written |

Village pad structures confirmed: `council_room`, `shelter`, `hovel`, `cobble_quarry`, `smithy` + town **NpcPad**.

### Lessons (FACT)

1. Town items are `TownType`, not `RegionType` — `/cv placeregion settlement` → `Not a region type`.
2. `/cv town` requires a real `Player` sender — RCON `execute as … run cv town` → `Unable to use town command for non-players`. Fix: `test act <player> run_as cv town <name>` + hold town item (`cv give` + hotbar).
3. Assert town with `test assert town <name> exists` (do not trust `performCommand` alone).
4. Prefer settlement-tier types (`potato_farm`, `inn`, `smithy`, `barracks`, `hovel`) until hamlet upgrade.

---

## Overnight loop control

```bash
# WSL
export PATH="$HOME/.nvm/versions/node/v25.8.0/bin:$PATH"
cd /mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner
tmux attach -t village-npc          # builder or watch log
tmux capture-pane -t village-npc -p # snapshot
# one-shot rebuild plan
RCON_PASSWORD=civsqa node scripts/village-builder.js
# overnight cinematic keep-alive (Steve walks pad; Cam orbits / spectates)
tmux kill-session -t village-npc 2>/dev/null || true
tmux new-session -d -s village-npc \
  "RCON_PASSWORD=civsqa FORCE_ORBIT=1 node scripts/village-watch.js 2>&1 | tee -a reports/village-watch.log"
```

npm: `npm run village-builder` (from `integration-tests/runner`, Node via WSL if Windows PATH lacks `node`).

---

## Code added

- `integration-tests/runner/lib/camera.js` — spectator Cam
- `integration-tests/runner/lib/actor.js` — `placeTown()` via `run_as`
- `integration-tests/runner/scripts/village-builder.js` — deterministic planner
- `integration-tests/runner/scripts/launch-viewer.ps1` — offline 26.1.2 client
- `integration-tests/runner/scripts/start-obs-capture.ps1` — OBS helper

---

## Resume checklist

1. `tmux ls` → `civs-qa` + `village-npc`
2. `test assert town NpcPad exists`
3. Open viewer → Direct Connect → `/spectate Cam`
4. Tail `reports/village-builder.jsonl`
5. Optional: Hermes MCP exploratory later — builder does **not** block on Hermes

## Blockers remaining

| Item | Status | Min action |
|------|--------|------------|
| Auto-join viewer without GUI click | **BLOCKED** soft | Manual Direct Connect; improve launcher args later |
| Full Director (orbit interest scoring) | **TODO** | Cam spectate is enough for tonight |
| Hamlet+ structures (warehouse, wheat_farm) | **BLOCKED** until hamlet upgrade | Evolve town when population/build-reqs met |
| Hermes as live planner overnight | **UNKNOWN**/optional | Deterministic planner running |

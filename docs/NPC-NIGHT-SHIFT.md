# NPC night shift — village builder + cinematic view

Labels: **FACT** · **OBSERVED** · **BLOCKED** · **UNKNOWN** · **INFERRED**

Date: 2026-08-11. Branch: `feat/npc-village-builder-49`. Issue: [#49](https://github.com/Daniel730/Civs/issues/49). PR: [#50](https://github.com/Daniel730/Civs/pull/50).

## Goal

Unattended agent founds/expands a Civs village on disposable WSL Paper QA and remains **watchable** via a spectator camera player + official Minecraft client.

Architecture (unchanged): Hermes → MCP → Agent Gateway → runner → RawKeepAliveActor + RCON → Paper QA. No Mineflayer. No second harness.

---

## How to watch NOW (working path)

### One-click (preferred)

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/launch-viewer.ps1
```

**OBSERVED (2026-08-11):** This:

1. Finds a reachable QA host (WSL eth0 IPv4 first — **not** `127.0.0.1`).
2. Kills stale `Minecraft *` java windows.
3. Launches official client `26.1.2` with `--quickPlayMultiplayer <host>:25565`.
4. Auto-joins as `Viewer`.
5. RCON-sets `gamemode spectator` + `spectate Cam`.

**Evidence (PASS):**

| Check | Result |
|-------|--------|
| Client log | `Connecting to 192.168.152.149, 25565` then `[CHAT] Viewer joined the game` |
| Window title | `Minecraft 26.1.2 - Multiplayer (3rd-party Server)` |
| RCON `/list` | `Steve, Cam, Viewer` |
| RCON spectate | `Now spectating Cam` |

### Manual fallback (only if auto-join fails)

1. Confirm QA: WSL `tmux ls` → `civs-qa` + `village-npc`; ports `25565` / `25575`.
2. In the Minecraft window: **Multiplayer → Civs QA NpcPad** (pre-seeded in `servers.dat`).
3. **Do not** use `127.0.0.1:25565` from Windows on this machine — it fails (see below).
4. If not auto-spectated: server console / RCON:

```text
gamemode spectator Viewer
execute as Viewer run spectate Cam
```

Or `/tp @s 5200 90 5200` to look at the pad.

### Why the first viewer failed (root cause)

| Cause | Label | Detail |
|-------|-------|--------|
| `--server` / `--port` removed | **FACT** | Client log: `Completely ignored arguments: [--userType, legacy, --server, 127.0.0.1, --port, 25565]`. Replaced by `--quickPlayMultiplayer` since 23w14a. |
| `127.0.0.1:25565` unreachable from Windows | **FACT** | TcpClient to `127.0.0.1:25565` = fail; `localhost`/`::1`/WSL eth0 = ok. Manual Direct Connect to `127.0.0.1` → `Connection refused`. |
| Client stayed on title / connect failed | **OBSERVED** | Window opened, but user never entered the world → "Não foi". |

### B. Camera players (always on when builder/watch runs)

| Player | Role |
|--------|------|
| `Steve` | Builder actor (`RawKeepAliveActor`) |
| `Cam` | Spectator; `execute as Cam run spectate Steve` |
| `Viewer` | Human / cinematic client (this machine) |

Camera code: `integration-tests/runner/lib/camera.js` (orbit via `FORCE_ORBIT=1`).

### C. OBS capture (optional)

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/start-obs-capture.ps1 -StartRecording
```

OBS: `C:\Program Files\obs-studio\bin\64bit\obs64.exe` (**FACT**). Window Capture → `Minecraft 26.1.2`.

### D. Logs if you cannot sit at the PC

| Artifact | Path |
|----------|------|
| Step JSONL | `integration-tests/runner/reports/village-builder.jsonl` |
| Watch log | `integration-tests/runner/reports/village-watch.log` |
| Client log | `%APPDATA%\.minecraft\civs-qa-viewer\logs\latest.log` |

---

## Environment probe

| Check | Result | Label |
|-------|--------|-------|
| Paper QA tmux `civs-qa` | UP (`paper.jar --nogui`) | **FACT** |
| Path | `/home/dansilva/civs-testserver` | **FACT** |
| Game `*:25565` / RCON `*:25575` | listening | **FACT** |
| Windows → `127.0.0.1:25565` | **FAIL** | **FACT** |
| Windows → WSL eth0 `:25565` | **OK** | **FACT** |
| Actor Steve + Cam | online, pad ~5200,82,5200 | **PASS** |
| Viewer auto-join + spectate Cam | after launcher fix | **PASS** |
| Production / `Civs_servidor` live | Not touched | **FACT** |

---

## Village progress (empirical)

Pad origin: **5200, 80, 5200**. Town name: **NpcPad**.

Village pad structures confirmed: `council_room`, `shelter`, `hovel`, `cobble_quarry`, `smithy` + town **NpcPad**.

### Lessons (FACT)

1. Town items are `TownType`, not `RegionType` — `/cv placeregion settlement` → `Not a region type`.
2. `/cv town` requires a real `Player` sender — use `test act <player> run_as cv town <name>`.
3. Prefer settlement-tier types until hamlet upgrade.
4. Minecraft 26.1.2 client auto-join requires `--quickPlayMultiplayer`, not `--server`.
5. From Windows to WSL Paper, prefer WSL IPv4 (`hostname -I`), not `127.0.0.1`.

---

## Overnight loop control

```bash
# WSL — preferred: NPC WORKER (move/break/place/swing, not AFK orbit)
export PATH="$HOME/.nvm/versions/node/v25.8.0/bin:$PATH"
cd /mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner
tmux kill-session -t village-npc 2>/dev/null || true
tmux new-session -d -s village-npc \
  "RCON_PASSWORD=civsqa ENABLE_HELPER=1 FORCE_ORBIT=1 node scripts/village-worker.js 2>&1 | tee -a reports/village-worker.log"

# Legacy watch-only (teleport orbit)
# tmux new-session -d -s village-npc \
#   "RCON_PASSWORD=civsqa FORCE_ORBIT=1 node scripts/village-watch.js 2>&1 | tee -a reports/village-watch.log"
```

### Monitor NPC work

| Artifact | Path |
|----------|------|
| Worker JSONL | `integration-tests/runner/reports/village-worker.jsonl` |
| Worker state | `integration-tests/runner/reports/village-worker-state.json` |
| Worker log | `integration-tests/runner/reports/village-worker.log` |
| tmux | `tmux attach -t village-npc` |

Jobs rotate: **patrol → builder → miner → farmer → stockpile** (+ periodic `placeregion` retries). Evidence lines include `"action":"work_tick"` with `move` / `breakBlock` / `placeBlock` results.

Optional second actor: `ENABLE_HELPER=1` joins **Alex** and multiplexes every other tick.

Recover if the worker dies:

```bash
bash scripts/recover-npc.sh
```

---

## Code added / fixed

- `integration-tests/runner/lib/camera.js` — spectator Cam
- `integration-tests/runner/scripts/village-builder.js` — deterministic planner
- `integration-tests/runner/scripts/village-worker.js` — overnight **work** loop (capabilities)
- `integration-tests/runner/lib/village/jobs.js` — job rotation planner
- `integration-tests/runner/scripts/launch-viewer.ps1` — quickPlay + reachable host + auto-spectate
- `integration-tests/runner/scripts/_rcon_once.js` — RCON helper for the launcher
- `integration-tests/runner/scripts/start-obs-capture.ps1` — OBS helper

---

## Resume checklist

1. `tmux ls` → `civs-qa` + `village-npc`
2. Run `launch-viewer.ps1` (one click)
3. Confirm window title contains `Multiplayer` and you are following Cam/Steve at the pad
4. Optional: OBS Window Capture

## Blockers remaining

| Item | Status | Min action |
|------|--------|------------|
| Full Director (orbit interest scoring) | **TODO** | Cam spectate is enough |
| Hamlet+ structures (warehouse, wheat_farm) | **BLOCKED** until hamlet upgrade | Evolve town when build-reqs met |
| Windows `127.0.0.1` → WSL game port | **BLOCKED** on this host | Use WSL IP / launcher auto-detect (fixed in viewer) |

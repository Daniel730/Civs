# Civs QA handoff

**Date:** 2026-07-17 (I/O detect + expanded batch)  
**Branch:** `paper-26.1.2-migration`  
**Test server:** WSL `/home/dansilva/civs-testserver` → `localhost:25565`  
**QA player:** Smokeshow (OP) · RCON `25575`/`civsqa`

## Fast vs slow path

| Path | Command | What it does | When |
|------|---------|--------------|------|
| **Fast (default)** | `python run_all.py structures` or `python run_all.py fast` | RCON `fill`/`setblock` build-reqs → `/cv give` → `/cv placeregion` → RCON chest stock + `cv newday` + `execute if items` | Daily coverage / CI-like smoke |
| **Slow (optional)** | `python run_all.py structures --legacy-window` | Esc/menus/WE wand/aim/mouse place | Debug placement aim only |

**Do not** interleave menu GUI / WE wand with structure batches. Menus = separate `run_all.py menus` when needed.

### Admin commands (civs.admin / OP)

- `/cv give <player> <itemType> [qty]`
- `/cv placeregion <player> <regionType> [x y z]` (alias `qa-place`)

Redeploy: `mvn -Dmaven.test.skip=true package` → copy `target/civs-1.11.7.jar` → `scripts/_tmux_server.sh stop|start|wait-boot`.

## Critical lessons (still true)

1. Chat fails while inventory open — Esc once, then T (legacy path only).
2. Never stack pads — `PadAllocator` + `PAD_MARGIN(12)`.
3. Production I/O: center=input; farms may use other chest; hopper wrong-item filter.
4. Town: reuse **QATown*** (settlement `max:1`).
5. Fast I/O: skip `period > 20s`; wait cap 12s; don't rabbit-hole tools-only FAIL.
6. **Potatoes = planted crops on farmland** (not items). **Redstone = dust/block on ground** at cy.
7. Prep+place one-at-a-time; burst-all-prep wipes neighbors.
8. Wipe/prune QA regions when quarry group (~12) or town ring fills.
9. **`data get` chest NBT truncates** — use `execute if items block … container.* minecraft:MAT`.
10. **`cv newday` only ticks daily-period regions** — short-period I/O relies on CommonScheduler.
11. Clear inventory before each give (stash/inventory count toward group max).

## Status (fast run `structures_fast_20260717_155133`)

| Metric | Value |
|--------|-------|
| Wall clock | **16.3s** for 20 types |
| Activated | **19 / 20** (cactus margin flaky) |
| I/O | **PASS 7** · FAIL 0 · SKIP 12 |
| Throughput target (≥8 in &lt;10m) | **MET** |
| Features RCON | 10 OK · SoftHook PASS (`features_20260717_155134`) |

### Latency budget (fast path)

| Step | Cap |
|------|-----|
| Between pads | 0.05s |
| Place (OK/FAIL from RCON) | no sleep; FAIL skips YAML poll |
| Ambiguous place YAML poll | ≤2s @ 0.25s |
| I/O after stock + `cv newday` | ≤12s poll @ 0.25s; period&gt;20s → SKIP |
| Hopper wrong-item (legacy) | 0.35s |

## Run

```powershell
cd C:\Users\Danie\Downloads\Civs-1.11.6\Civs-1.11.6\scripts\qa
.\.venv\Scripts\activate
python run_all.py fast                    # structures fast + RCON features
python run_all.py structures              # fast structures only
python run_all.py structures --only gravel_quarry arrow_trap potato_farm
python run_all.py structures --legacy-window   # slow debug
python run_all.py features --skip-window
```

## Next

1. Confirm cactus_farm with PAD_MARGIN=12 (or space farm pads further).
2. Menus/shop buy = separate short window smoke.
3. Between dense runs: delete `plugins/Civs/regions/*.yml` then `cv reload` (async writer can re-save if reload first).

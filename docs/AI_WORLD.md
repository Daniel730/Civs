# AI World Population

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**PARTIAL** — Issue **#67** vertical slice (quest + physical mine) plus issue **#72**
agent-quality layers (metrics, survival, intention cache, `walk_path`) on the village worker.

Autonomy claim: **Level 1–3 partial** (goal-directed + reactive replan + persistent memory).
**Not** Level 8.

## Empirically verified

| Capability | Evidence |
|------------|----------|
| `RpgBridge` accept/observe | Prior scenarios 06; D-AP-008 |
| `quest_detail` / `next_quest` / `pois` | Harness reflection against RPGServer |
| `find_block` + `break_block` → RPG `handleMineBlock` | Paper `Player.breakBlock` fires `BlockBreakEvent` |
| `/test world nearby` | Civs `RegionManager` + nearby entities/players/biome |
| Deterministic quest loop + mine executor | `npm run test:ai-world-unit` |
| **Live QA physical mine complete** (#67) | `08-ai-world-quest-slice` — `completed_quests` contains `ai_world_mine_probe` |
| Metrics / survival / intention / walk client (#72) | `npm run test:nightshift-unit` — **86/86 PASS** |
| Harness `walk_path` / `cam_shot` compile (#72) | `civs-test-harness` `mvn package` SUCCESS |
| Live capability presence (#72) | WSL QA RCON: `walk_status` / `cam_status` → `player_offline` (not `unknown_action`) |

### Live run notes

**#67 (2026-08-11):** Actor `QaBot` online; fixture quest accepted; memory under `reports/ai-world/`.
**PARTIAL:** Vault reward money delta was `0` at balance=1e6.

**#72 finish session:** Paper QA up; actors offline — no new overnight
`analyze-worker-log.js` before/after arrival-rate claim. Phase-0 baseline remains the
numbers recorded on issue #72 (44% walk arrive, 81.9% recover teleport, tick gap max 324 s).

## Architecture

```text
RawKeepAliveActor → /test act|observe|world|rpg → lib/ai-world + lib/survival + lib/village
                 → lib/observation (CinematicDirector) → MCP Gateway
```

LLM = WHAT (optional hook). Deterministic capabilities = HOW.

### Agent quality stack (#72)

| Layer | Module | Status |
|-------|--------|--------|
| OTel metrics | `lib/metrics.js` | **IMPLEMENTED** (registry + OTel instruments; unit-tested) |
| Survival FSM | `lib/survival/` | **IMPLEMENTED** (SAFE…RECOVER + work-area leash) |
| Intention cache + anti-stall | `lib/ai-world/intention-cache.js` | **IMPLEMENTED**; LLM stage is a ladder step only — **not wired** to a model |
| Settlement focus | `lib/village/focus.js` | **IMPLEMENTED** |
| Continuous walk | harness `walk_path` + `lib/village/walk.js` | **IMPLEMENTED** (legacy `step` fallback; teleport last resort) |
| Enriched observe | `CapabilityActions` hostiles/deaths/lava/… | **IMPLEMENTED** |

### Authoritative state sources

| Concern | Source |
|---------|--------|
Autonomy claim: **Level 1–3 partial** (goal-directed + reactive replan + persistent memory) as of issue #72, not Level 8.
| POI coordinates | RPGServer `DiscoveryRegistry` / `discoveries/pois.yml` |
| Civs regions/towns | `RegionManager` / `TownManager` via `/test world nearby` |
| Economy reward | Vault via `/test money get` before/after complete |
| Survival inputs | `/test observe` fields: health, food, hostiles, deaths, lava/water, fall, air |

### Persistence policy

**Persistent:** identity, needs, goals (life/long/medium + quest-linked current), relationships, skills, episodic/semantic/social memory, `activeQuestId`.

**Ephemeral:** working memory, currentPlan, position samples, cooldowns, live inventory snapshot, intention TTL (20–60 s).

## BLOCKED / partial

```text
PARTIAL: Reward money delta was 0 on #67 live run at balance=1000000 — tighten money probe.

PARTIAL: walk_path is primary for village-worker; greedy move_to remains for older
  callers (D-AP-011 superseded for the worker path by D-AP-021). Live arrival-rate
  improvement vs Phase-0 baseline is NOT yet re-measured on a long run.

TODO: Wire CONSULT_LLM anti-stall stage to an optional planner (currently logs only).
TODO: Social Level 4+. Construction failure-mode live cases (death mid-project).
```

## QA fixture

Disposable quest (not production story):

`integration-tests/runner/fixtures/ai_world_mine_probe.yml`

Copy into `plugins/RPGServer/quests/` on disposable QA and `/rpg reload`.

## Autonomy ladder

| Level | Status |
|------:|--------|
| 0 Scripted | EXISTS (village-worker) |
| 1 Goal-directed | PARTIAL (focus + intention cache) |
| 2 Reactive | PARTIAL (survival + anti-stall + walk recovery) |
| 3 Persistent memory | PARTIAL (#67) |
| 4–8 | TODO |

## Related

- Issues **#67**, **#72**; D-AP-018, D-AP-019, D-AP-020, D-AP-021
- `docs/AGENT_PLATFORM.md`, `docs/CINEMATIC_DIRECTOR.md`

# AI World Population

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**PARTIAL** — Issue **#67** vertical slice now includes **physical mine execution** + world/POI observation adapters (2026-08-11 nightshift).

Autonomy claim: **Level 1–3 partial** (goal-directed + reactive replan + persistent memory). **Not** Level 8.

## Empirically verified (this branch)

| Capability | Evidence |
|------------|----------|
| `RpgBridge` accept/observe | Prior scenarios 06; D-AP-008 |
| `quest_detail` / `next_quest` / `pois` | Harness reflection against RPGServer |
| `find_block` + `break_block` → RPG `handleMineBlock` | Paper `Player.breakBlock` fires `BlockBreakEvent` (RPG listener) |
| `/test world nearby` | Civs `RegionManager` + nearby entities/players/biome |
| Deterministic quest loop + mine executor | `npm run test:ai-world-unit` (16/16) |
| **Live QA physical mine complete** | `08-ai-world-quest-slice` on WSL QA — `completed_quests` contains `ai_world_mine_probe`, `remembered=true`, 29 structured events |

### Live run notes (2026-08-11)

- Actor `QaBot` online; fixture quest accepted after freeing a max-active slot.
- Authoritative completion: `rpg_observe.completed_quests` includes probe id.
- Memory: `quest_complete` episode persisted under `reports/ai-world/`.
- **PARTIAL:** Vault balance delta for reward money was `0` at 1e6 balance (completion verified; reward apply still needs a tighter money probe / lower starting balance).

## Architecture

```text
RawKeepAliveActor → /test act|observe|world|rpg → lib/ai-world → MCP Gateway
```

LLM = WHAT (optional hook). Deterministic capabilities = HOW.

### Authoritative state sources

| Concern | Source |
|---------|--------|
| Quest accept/progress/complete | RPGServer `QuestManager` via RpgBridge — **never** `performCommand` alone |
| POI coordinates | RPGServer `DiscoveryRegistry` / `discoveries/pois.yml` |
| Civs regions/towns | `RegionManager` / `TownManager` via `/test world nearby` |
| Economy reward | Vault via `/test money get` before/after complete |

### Persistence policy

**Persistent:** identity, needs, goals (life/long/medium + quest-linked current), relationships, skills, episodic/semantic/social memory, `activeQuestId`.

**Ephemeral:** working memory, currentPlan, position samples, cooldowns, live inventory snapshot.

## BLOCKED / partial

```text
PARTIAL: Reward money delta was 0 on live run at balance=1000000 — quest completion
  is verified via completed_quests; tighten money probe (set balance low before accept).

FACT: True pathfinder still greedy move_to (D-AP-011).

TODO: Construction foundation (P5) deferred until reward probe tightened + failure-mode
  live cases (death/disconnect) exercised. Social Level 4+.
```

## QA fixture

Disposable quest (not production story):

`integration-tests/runner/fixtures/ai_world_mine_probe.yml`

Copy into `plugins/RPGServer/quests/` on disposable QA and `/rpg reload`.

## Autonomy ladder

| Level | Status |
|------:|--------|
| 0 Scripted | EXISTS (village-worker) |
| 1 Goal-directed | PARTIAL |
| 2 Reactive | PARTIAL (danger/replan/stuck) |
| 3 Persistent memory | PARTIAL |
| 4–8 | TODO |

## Related

- Issue **#67**, D-AP-018
- `docs/AGENT_PLATFORM.md`, `docs/CINEMATIC_DIRECTOR.md`

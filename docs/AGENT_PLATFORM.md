# Agent Platform

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Goal

Two independently deployable systems sharing one capability/observation core:

- **System A — QA / gameplay agents** (deterministic scenarios + LLM exploratory QA)
- **System B — AI world + cinematic broadcast** (population + Director + camera)

## Current completion state

| Area | State | Evidence |
|------|-------|----------|
| Recon + architecture docs | **IMPLEMENTED** | this doc set |
| Integration harness (observe/assert) | **E2E TESTED** (prior) | `docs/INTEGRATION-TESTING.md`, 2 scenarios |
| Raw keep-alive actor on 26.1.2 | **EMPIRICALLY VALIDATED** (prior) | probe + scenarios |
| Mineflayer on 26.1.2 | **FAILED / blocked** | `MINEFLAYER-PROBE-RESULTS.txt` |
| Server-side capability layer | **EMPIRICALLY VALIDATED** (subset) | `CAPABILITY-PROBE-RESULTS.txt` — 14/14 |
| RPG observe bridge | **EMPIRICALLY VALIDATED** | scenario `04-rpg-observe` — 8/8 |
| Death / respawn / reconnect | **EMPIRICALLY VALIDATED** | scenario `05` — 12/12 |
| RPG quest accept | **EMPIRICALLY VALIDATED** | scenario `06` — abandon slot + `QuestAcceptResult.SUCCESS` |
| LLM planner | **TODO** | — |
| AI world / Director / OBS | **TODO** | — |

## Package layout (incremental — extend, don't fork)

```text
integration-tests/
  test-harness-plugin/     # observation + capability execution (server JVM)
  runner/
    lib/
      harness.js           # RCON typed client
      actor.js             # RawKeepAliveActor (presence)
      capabilities.js      # structured capability client  (NEW)
      dsl.js / scenario.js / evidence.js / junit.js
    scenarios/
docs/
  ARCHITECTURE.md …
```

Future extraction to a top-level `agent/` package is allowed **after** capabilities are empirically stable. Do not create a competing runner.

## Capability contract

Every capability returns structured JSON (via `TEST-RESULT json=…`):

```json
{
  "success": true,
  "action": "break_block",
  "target": "world:10,64,10",
  "duration_ms": 12,
  "reason": null,
  "data": {}
}
```

Rules:

- Never return fake success.
- Only expose actions verified against Paper API and/or live server.
- Capabilities that need an online player fail with `reason=player_offline` if absent.

## Verified Paper APIs used (capability layer)

| Capability | API | Label |
|------------|-----|-------|
| `sneak` / `sprint` | `Player.setSneaking` / `setSprinting` | FACT (javap paper-api 26.1.2) |
| `break_block` | `Player.breakBlock(Block)` → fires `BlockBreakEvent` | FACT (Paper javadoc) |
| `attack` | `LivingEntity.attack(Entity)` | FACT (javap) |
| `swing` | `LivingEntity.swingMainHand()` | FACT (javap) |
| `look` | `Player.setRotation(yaw,pitch)` | FACT (javap) |
| `teleport` | `Entity.teleport(Location)` | FACT (Bukkit) |
| `observe_player` | health/food/loc/inventory getters | FACT |
| `place_block` | `BlockPlaceEvent` + setType (no `Player.placeBlock`) | INFERRED until live probe |
| `jump` | `setVelocity` upward impulse (+ optional `setJumping`) | INFERRED until live probe |
| pathfind `move_to` | UNKNOWN on 26.1.2 without Mineflayer/pathfinder | TODO (teleport stub ≠ navigation) |

## Presence vs control

| Layer | Responsibility |
|-------|----------------|
| RawKeepAliveActor | Keep a real `Player` connected (protocol login) |
| Server-side `/test act` | Execute verified actions **as that player** inside the JVM |
| Harness observe/assert | Authoritative internal state checks |
| RCON `/cv …` | Admin QA shortcuts (placement pipeline) — not a substitute for block-place events |

## Roadmap (priority order)

### P0 — Safety
- Isolated testserver only; never destructive prod experiments.
- Explicit capability failures; evidence bundles on scenario fail.

### P1 — Capability core (now)
1. `/test act` + `/test observe` in harness.
2. Runner `capabilities.js` + scenario covering break/sneak/attack/observe.
3. Empirical probes on WSL testserver; document results.
4. Expand: hotbar select, interact, container open (after probes).

### P2 — QA scenarios
- Grow DSL library (town, shop, persistence restart).
- Wire CI job around existing runner.

### P3 — RPG/Civs adapters
- Observe quest/profile/class via harness or RPG commands (investigate first).

### P4 — LLM exploratory QA
- Replaceable `LLMProvider`; structured plan validation; no arbitrary server commands from model text.

### P5–P7 — AI world, Director, OBS
- Only after P1–P2 are behavioral, not aspirational.

## Coordination

Hermes Agent and other Cursor agents may work in parallel. Prefer extending `integration-tests/` and documenting decisions in `DECISIONS.md`. Do not delete harnesses or reset production worlds.

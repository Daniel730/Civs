# Construction quality pipeline (V1)

Status: vertical slice for autonomous NPC builds.  
Refs: #66 (no platforms / natural terrain), village aesthetics (#64).

## Principle

```text
LLM / job planner  → intent, purpose, priorities
Planner            → structured blueprint IR
Validator          → legality, geometry, safety, palette, proportions
ConstructionEngine → block ops only via ConstructionTransaction
Inspector          → measurable quality score
RepairEngine       → deterministic fix or rollback
Memory             → learn from outcomes
```

The LLM must **never** place arbitrary blocks. Vision review (optional stub) never mutates the world.

## Pipeline stages

Need → Site selection → Blueprint → Pre-build validation → Material validation → Construction → Post-build inspection → Repair **or** Rollback → Completed structure.

Validation is never skipped. Unsafe intent → `PROJECT_ABORTED` / replan (do not build).

## Module map

`integration-tests/runner/lib/village/construction/`

| File | Role |
|------|------|
| `blueprint.js` | Structured IR + compile from aesthetic templates |
| `styles.js` | Settlement styles + palettes + proportion limits |
| `site.js` | `findSurfaceY`, slope, scored site selection |
| `validate.js` | Foundation / float / palette / architecture / proportions |
| `transaction.js` | BEGIN / PAUSE / COMMIT / ROLLBACK / ABORT + change log |
| `engine.js` | Ordered placement through transaction |
| `inspect.js` | Post-build checks + quality score |
| `repair.js` | Deterministic repair or rollback |
| `memory.js` | Persist outcomes under `reports/construction-memory.json` |
| `visualCritic.js` | Optional stub — suggestions only |
| `pipeline.js` | Orchestrator (`runProject`) |

## Hard invariants

```text
NORMAL_BUILDING_FLOATING_BLOCKS = 0   (unless blueprint.elevated)
UNEXPLAINED_BLOCK_CHANGES = 0
UNRELATED_WORLD_DAMAGE = 0
```

## Runtime wiring

- `village-worker.js` builder/farmer jobs call `construction.runProject` (incremental chunks, resumable `PROJECT_PAUSED`).
- `village-builder.js` `preparePad` **does not flatten** unless `VILLAGE_ALLOW_PAD_FLATTEN=1` (unsafe cinematic opt-in).

## Tests

```bash
cd integration-tests/runner
npm run test:construction-unit
# optional live QA:
npm run construction-scenarios
```

## Non-goals (V1)

- Java FAWE paste full undo (terrain-only rollback remains a known gap in `TerrainAdapter`)
- Emergent multi-hour settlement sandbox
- Mandatory vision-model review
- Full district urban planner

## Java note

Player instant-build under `regions/placement` is unchanged in V1. Agent construction quality lives in the Node village runner (where autonomous NPC builds actually run).

# AI World — Learning Layer (Phase 3)

> Status: **shipped + live-validated**. No RL. Offline training step IMPLEMENTED and applied at runtime.

## Offline training (IMPLEMENTADO)

`scripts/aiworld-train.js` (exposto como `npm run aiworld:train`) lê o dataset JSONL, agrega
reward por `(contexto → intent)`, e escreve `reports/aiworld-weights/weights-<agent>.json`
(contextual bandit / preference learner: mean-centering de reward por contexto, clamp [-1,1],
descontado por confiança). O `NeuralPolicy` carrega estes pesos no arranque (modo neural/shadow)
e aplica `bias[context][intent]` em `scoreIntents`.

**Loop fechado:** OBSERVE → REPRESENT → DECIDE (com pesos) → ACT → OUTCOME → REWARD →
STORE (JSONL) → TRAIN (offline) → UPDATED POLICY. Sem RL; treino 100% offline e reproduzível.

## What this phase delivers

Phase 3 makes the NPCs **learn from experience** without any reinforcement learning in the
live path. The server only *produces* experiences; training is a separate, reproducible
offline step (future) that reads the dataset and writes a weights artifact back.

- Every real decision is recorded as an experience (state vector, personality, candidate
  intents, the chosen action, and — later — the outcome + reward).
- The dataset is **append-only JSONL** (`reports/aiworld-experiences/experiences-<agent>.jsonl`),
  trivially consumable by Python / jq / DuckDB / any tool.
- One **shared** `ExperienceStore` collects experiences for all agents (shared learned-policy
  direction), while each agent keeps its own persistent `AgentState` (Phase 2) for individual
  memory. This is exactly the brief's "shared-policy + individual memory" direction.
- A `NeuralPolicy` runs in `deterministic | neural | shadow` mode:
  - `deterministic`: baseline mirror, no neural scoring.
  - `shadow`: neural scores are *computed and recorded* (disagreement metric) but **never**
    become the executed action.
  - `neural`: same computation; still falls back to the baseline mirror until a trained
    weights artifact exists (never crashes, never overrides a broken model).
- Safety invariants (from the brief): error/NaN → fallback, never crashes the NPC or server.

## Data flow (live)

```
village-worker tick
  └─ chooseFocus(...)                    # the executed decision (unchanged)
  └─ recordFocusDecision({...})         # -> ExperienceStore.recordDecision()
       └─ encodeState(observation)      # fixed-length normalized vector (VEC_LEN)
       └─ NeuralPolicy.scoreIntents()   # shadow/neural scores (recorded, not executed)
       └─ experienceStore.recordDecision() -> episodeId, appended to JSONL
  ... later, when the decision resolves ...
  └─ recordFocusOutcome(agentId, episodeId, {died|recovered|goalCompleted|stalled|damageTaken})
       └─ experienceStore.recordOutcome() -> computeReward(outcome) -> reward
       └─ appended to the same JSONL line for that episode
```

The experience schema (`aiworld.experience` v1) carries enough context to investigate *why*
a decision was good or bad: `stateVec`, `personality`, `candidates` (with both deterministic
and neural scores), `chosenIntent`, `policyMode`, and the later `outcome.reward`.

## Reward signal (state-rep.computeReward)

| Outcome | Reward |
|---|---|
| `goalCompleted` | `+1.0` |
| `recovered` (survived a bad state) | `+0.6` |
| `stalled` | `-0.4` |
| `died` | `-1.0` |
| damage taken | linear penalty, clamped to `[-2, +2]` |

Weights are configurable (`recordFocusOutcome(agentId, episodeId, outcome, rewardWeights)`).

## Offline training step (no live path)

A separate script (`scripts/aiworld-train.js`, `npm run aiworld:train`) reads
`reports/aiworld-experiences/*.jsonl` and writes `reports/aiworld-weights/weights-<agent>.json`
(or `weights-shared.json`). The live process loads it via `NeuralPolicy.loadWeights()` only when
present; absence is the safe default (mirror baseline). This keeps LIVE ≠ TRAINING: the server
never trains, it only produces data. Re-run `npm run aiworld:train` periodically to refine the
policy as more experiences accumulate.

## Validation

- `test/neural-policy.test.js` — state-rep encoding, NeuralPolicy safety invariants,
  ExperienceStore decision+outcome+reward persistence, **loadWeights applies bias**.
- `test/learning-integration.test.js` — `recordFocusDecision` + `recordFocusOutcome` produce a
  complete experience (decision snapshot + outcome-appended line with finite reward) in the
  shared store.
- `test/aiworld-train.test.js` — offline aggregation + NeuralPolicy weight application.
- **Live (QA server 192.168.152.149):** worker run in `AIWORLD_POLICY=neural` recorded 40+
  experiences with `policyMode: neural` and non-null `neuralScores`. Isolated probe confirmed
  the learned bias is applied at runtime: in SAFE context `farmer` 0.5→1.5, `survive` 0.5→-0.5.
  Full unit suite: 268/268 passing.

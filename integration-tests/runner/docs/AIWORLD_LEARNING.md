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

## Outcome closure (Task A) — decision→action→consequence→reward→learning

**Before:** `recordFocusOutcome` only fired on death (`village-worker.js` l1077) and stall
(l1303). Success/goal ticks never closed → ~672/674 experiences stayed `pending` (only
`ratedSamples: 2/674`). Worse, the death path closed `lastEpisode[who]` — the PREVIOUS tick's
decision — so even the few outcomes were misattributed.

**Fix:**
- **A1** Every work tick now closes its own focus decision with a real outcome (after `runJob` +
  stall detection). `ExperienceStore.recordOutcome` is idempotent (deletes from `open`), so
  death/stall closures and the success closure don't double-count.
- **A2** Success closure carries objective-reflecting reward: `progressDelta` (normalized by
  `OBJECTIVE_GOALS[job]`), `goalCompleted` (objective reached its progress goal), `damageTaken`
  (health before/after the tick). `computeReward` already maps these to `+`/`-` reward.
- **A3** Death now records a fresh `survive` decision for the CURRENT tick and closes it, so
  death is attributed to the decision that was actually live (not a stale previous-tick one).
- **A4** `aiworld-train.js` `aggregate` now reports `ratedByIntent` (closure rate per intent) and
  `rewardByIntent` (reward distribution per intent), not just a flat `ratedSamples` count. Also
  fixed `stats.ratedSamples` to ACCUMULATE across contexts (was overwritten per-context).

**Live evidence (QA server, neural mode, ~3 min run):**
- `ratedSamples: 266 / 721` (was 2/674) — 37% of experiences now carry a real outcome.
- `rewardByIntent`: `farmer:+54`, `build:+2`, `maintain:-159`, `survive:-44` — a *varied*
  distribution, so the learner can tell good decisions (farm/build → progress) from bad ones
  (maintain/survive in danger → damage/death). Not "674 with +1 for everything".
- Tests: `test/aiworld-outcome-closure.test.js` (4 cases: reward shape, success closure,
  decision.js closure, aggregate distribution). Full suite: **278/278 passing**.

**Milestone reached:** the loop `decision → action → world consequence → outcome → reward →
learning → next decision` is now genuinely closed. Only now does sustained Steve+Alex play
actually accumulate *learning signal* rather than logs of an agent that never knew if it won.

## Body behaviour (Task B, Phase 1) — survival priority + no teleport-as-locomotion

**Before (live observation on QA server):** Steve kept building while a mob killed him (no survival
preemption — the worker only reacted on death), and teleported every tick (`walkTo` work path fell
through to Stage-4 recovery teleport because `allowTeleport` defaulted to `true`). Read as "walking in
circles like a roach, teleporting, dying without reacting".

**Fix:**
- **B1** In the work loop, right after `monitor.assess`, if `state ∉ {SAFE,CAUTION}` and the
  recommended action is `flee`/`defend`/`retreat`/`recover`, call `executeSurvival(...)` and `return`
  (next `setInterval` tick re-assesses). This realizes the priority chain
  EMERGENCY→DANGER→RECOVER→SURVIVE→TASK→EXPLORE/BUILD/MINE — the body obeys the brain's survival
  verdict instead of blindly working.
- **B2** All work-path `walkTo` calls (founding, stand, block-place) now pass `allowTeleport: false`.
  Teleport is no longer "normal movement"; the agent walks or stalls, and real recovery teleport only
  happens in `executeSurvival` `recover` (dead/too-far-from-work), never per-tick.

**Live evidence (QA server, neural mode, ~90s run):**
- Every `walk`/`walkBlock` in `work_tick` shows `recoverTeleport: false` — no more per-tick teleport.
- `survival_preempt` fired on `ESCAPE` (healthPct 0.07, recommended `flee`) and `RECOVER`
  (healthPct 0, recommended `recover`) — the agent STOPPED working and fled/recovered instead of
  dying mid-construction. While `CAUTION` (hostile nearby, HP 53%) it kept building (correct).
- Tests: `test/aiworld-body-behavior.test.js` (Stage-4 no-teleport, monitor→non-work mapping,
  executeSurvival handled, SAFE→work). Full suite: **282/282 passing**.

**Phase 2 (NOT yet done — needs harness extension, not just runner):**
- Eat when hungry (`cap.eat` / `harness.raw('eat')` — not yet exposed in `lib/capabilities.js`).
- Inventory management / deposit-to-stockpile (`cap.getInventory` / deposit API — not exposed).
- Swim (aquatic pathfinding in `lib/village/walk.js`).
- Active exploration objective in `chooseFocus`.
These are tracked as follow-ups; the agent already flees, builds, mines, and no longer teleports.

## Body behaviour (Task B, Phase 2) — travels, flees directionally, absorbs the world

**Before (continued live observation):** even after B1/B2 the agent still teleported on far goals
(Stage-1 recovery teleport was untouched), fled blindly toward origin instead of away from the
threat ("apanha sem saber de quem"), and re-derived everything each tick — "não absorve o mundo".

**Fix:**
- **B3** `lib/village/walk.js` Stage-1: when `allowTeleport:false`, instead of teleporting the gap
  for goals beyond `recoverDistance` (40), it now walks in intermediate `walk_path` hops (each
  within A* range) and reports `stuck` honestly if a hop fails. Teleport remains only when the
  caller explicitly allows it (legacy behaviour preserved behind the flag).
- **B4** `lib/survival/execute.js` flee: reads `assessment.raw.nearest_hostile.{x,z}`, computes a
  point OPPOSITE the threat (vector away from it) and walks there; falls back to origin only if the
  threat position is unknown. No more running *toward* danger blindly.
- **W1** `lib/ai-world/world-memory.js` (new): per-agent spatial/episodic memory — threats seen at
  a place (with TTL), deaths/damage events, blocks placed/broken. Exposes compact `features()`
  (nearestThreatDist, threatSeen, dangerZone, counts).
- **W2** `scripts/village-worker.js`: each tick feeds the observation into `getWorldMemory(who)`
  (threats, deaths) and attaches `assessment.worldMemory` to the focus decision.
- **W3** `lib/village/focus.js`: `chooseFocus` now takes `worldMemory`; if `dangerZone` is set it
  forces `survive` even in CAUTION (the agent remembers a dangerous spot and stops working there).

**Verification:**
- Unit: `test/aiworld-body-phase2.test.js` (B3 no-teleport branch, B4 directional flee, W1-W3
  memory+focus). Full suite: **285/285 passing**.
- Ad-hoc (`hermes-verify-aiworld-body-p2.js`): 10/10 — B3 branch, B4 flee z>100 away from threat,
  W1 danger-zone flag, W3 focus override, worker wires worldMemory into chooseFocus.

**Status:** the body now travels on foot (no teleport-as-locomotion anywhere), flees *away* from the
known threat, and remembers dangerous places across ticks. The agent is no longer a blind script —
but the *decision* layer is still a deterministic `if/else` (chooseFocus). Next step (per Dan's
direction): replace that with a local LLM brain (Ollama) for true autonomy/learning — see plan.

## Local LLM brain (Ollama) — inference + offline fine-tune

**Per Dan's direction:** NPCs should be autonomous entities that *learn*, not scripts. Two parts:

**(a) Inference (LIVE).** `lib/ai-world/ollama-brain.js` talks to a local Ollama server
(`http://localhost:11434` by default; override with `OLLAMA_ENDPOINT` / `OLLAMA_MODEL`). It builds a
human-readable world snapshot (health, survivalState, threats, remembered danger zone) and parses a
JSON `{focus, reason, target}`. The worker runs it via `AIWORLD_POLICY=ollama` (executes the LLM
focus) or `ollama-shadow` (logs only, deterministic still executes). **Safety invariant:** any
failure — timeout, bad JSON, model down — makes `decide()` return `null` and the worker falls back
to the deterministic `chooseFocus`. The NPC never stalls or crashes because the brain hiccupped.

**World memory in the prompt.** The snapshot the LLM receives is enriched with the agent's
`worldMemory` (W1): it shows how many threats are *remembered* at/near the current spot, how many
blocks were placed/broken, and whether a danger zone is flagged — so the model decides with spatial
context from prior ticks, not just the instantaneous observation. This is what makes the NPC "absorb
the world" instead of re-deriving everything each tick. When memory is empty the prompt states
"nothing remembered yet" so the model does not invent context.
**(b) Fine-tune (OFFLINE, makes it actually learn).** `scripts/aiworld-finetune.py` distills the
closed outcome/reward loop (Task A) into an Ollama chat fine-tune dataset:
- reads `reports/aiworld-experiences/experiences-*.jsonl` (rated lines only, `outcome != null`)
- `reward >= 1` -> POSITIVE example: assistant recommends the `chosenIntent`
- `reward <= -2` (died / heavy damage) -> NEGATIVE example: assistant explains what NOT to do and
  gives the correct override (`survive` when a hostile was present)
- mid-range rewards omitted (not informative)
- writes `reports/aiworld-finetune/dataset.jsonl` (Ollama chat format), `Modelfile`, `manifest.json`

Operator step (needs the `ollama` CLI, not run here): `ollama create civs-brain -f Modelfile`, then
set `OLLAMA_MODEL=civs-brain` when launching the worker. The trained model then biases future
decisions toward what actually survived/built in the past.

**Verification:**
- Unit: `test/ollama-brain.test.js` (offline fallback, JSON parse, focus vocabulary). Suite 286/286.
- Ad-hoc: 12/12 (ollama wiring + coexistence with B1/B2/W1).
- Fine-tune dataset: generated from 319 rated experiences -> **122 valid examples (32 pos / 90 neg),
  0 malformed**; `manifest.json` records per-agent counts (Steve 107, Alex 15, LearnBot 0).

## Continuous-learning loop (close the cycle)

The pieces above form a full loop, orchestrated by `scripts/aiworld-learn-loop.sh`:

```
  LIVE RUN (worker, AIWORLD_POLICY=neural|ollama)
      |  records decisions + later outcomes  (Task A)
      v
  reports/aiworld-experiences/experiences-*.jsonl   (rated: outcome.reward set)
      |
      |  aiworld-finetune.py   (distill reward -> training examples)
      v
  reports/aiworld-finetune/dataset.jsonl  (+ Modelfile, manifest.json)
      |
      |  ollama create civs-brain -f Modelfile   (only if `ollama` CLI present)
      v
  local model "civs-brain"  --OLLAMA_MODEL=civs-brain-->  next LIVE RUN
```

`OllamaBrain` reads `OLLAMA_MODEL` (explicit arg > env > `llama3.1:8b` default), so a trained
`civs-brain` is picked up automatically when the worker is launched with `OLLAMA_MODEL=civs-brain`.
The loop is safe: if `ollama` is not installed, the script only regenerates the dataset and the
worker keeps running on the deterministic brain (or a previously trained model). No destructive
step, no external API cost — everything is local on your PC.

**Verification:**
- Unit: `test/ollama-brain.test.js` covers `OLLAMA_MODEL` env default + explicit override (288/288).
- `aiworld-learn-loop.sh` is idempotent; step [1] regenerates the dataset from live experiences,
  step [2] is skipped cleanly when `ollama` is absent (verified: ollama not on PATH on build host).

# AI World — Camada Neural (MVP)

Evolução do sistema de decisão dos NPCs para uma arquitetura de
**memória + planeamento + aprendizado**, sem reescrita destrutiva e sem RL neste estágio.

## Princípios (decisões arquiteturais)

1. **Não usar RL agora.** Aprendizado offline a partir das experiências reais dos NPCs.
   Só introduzimos RL se os dados provarem que é a melhor solução (ver "Próximos passos").
2. **JS puro, sem dependências pesadas.** O stub corre em qualquer Node; inferência < 1 ms.
3. **Não substituir `scoreNeeds()`.** O determinístico é o *baseline* e o *fallback* obrigatório.
4. **LIVE INFERENCE ≠ OFFLINE TRAINING.** O servidor só produz experiências e executa um
   modelo já treinado. O treino é um passo separado e reproduzível (`scripts/aiworld-train.js`,
   exposto como `npm run aiworld:train`). **Implementado** — fecha o loop de aprendizagem.
5. **Shadow mode** permite comparar neural vs determinístico sem risco de regressão.
6. **Invariantes de segurança** nunca podem ser quebrados pela policy neural (ver abaixo).
7. **Direção futura: shared learned policy + memória/estado/personalidade individual.**
   A arquitetura já é compatível: o state vector é agent-agnóstico; personalidade e memória
   entram separadamente. Não implementamos weights partilhados ainda.

## Pipeline (MVP)

```
OBSERVATION (observe RCON)
  → STATE VECTOR (encodeState)
  → MEMORY RETRIEVAL (memória episódica já existe em memory.js; retrieval futuro)
  → CANDIDATE INTENTS (scoreNeeds)
  → POLICY SCORING (NeuralPolicy.scoreIntents; em deterministic = mirror do baseline)
  → SAFETY/PLANNER VALIDATION (intacto; CONSULT_LLM intacto)
  → ACTION (executeSurvival / work loop)
  → OUTCOME (death, goal done, stall, dano — atrelado depois via recordOutcome)
  → REWARD (computeReward, explícito e configurável)
  → EXPERIENCE DATASET (ExperienceStore: JSONL append-only por agente)
```

## State vector

`encodeState(obs, ctx)` → `{ version, fields, vec, len }`. 17 campos normalizados 0..1,
estáveis por índice (adicionar = append + bump VERSION):

`health_pct, food_pct, air_pct, hostiles_near, nearest_hostile_dist, danger_flag,
escape_flag, recover_flag, distance_from_work, current_goal_progress, no_progress_ms,
stall_stage, time_since_last_meal, has_armor, light_level, in_water, in_lava`

## Reward (explícito, simples, configurável)

`computeReward(outcome, weights)` — pesos documentados e sobreponíveis via `weights`:

| sinal | peso default | direção |
|---|---|---|
| goalCompleted | +1.0 | positivo |
| progress (por 0.01) | +0.1 | positivo |
| death | -1.0 | fortemente negativo |
| unnecessaryDamage (por 0.1 de vida) | -0.1 | negativo |
| stall | -0.2 | negativo |
| abandonUseful | -0.3 | negativo |
| recoverySuccess | +0.4 | positivo |

O reward é clampado a [-2, +2] para estabilidade.

## Dataset schema

Cada experiência (`buildExperience`) captura contexto suficiente para investigar *porquê*:
`episodeId, agentId, at, observation, stateRep{version,fields,vec}, personality,
candidates[id,base,motive], chosenIntent, deterministicScores, neuralScores (null em
deterministic), policyMode, action, outcome{…reward, rewardComponents}, stateVec`.

Persistido em `reports/aiworld-experiences/experiences-<agentId>.jsonl` (append-only, LDJSON).
Consumível por Python/jq/DuckDB para o treino offline futuro.

## Policy interface

`NeuralPolicy`:

- `scoreIntents(stateVec, candidates, ctx)` → `{ scores, usedModel, fellBack }`
  (`ctx` = contexto de sobrevivência: SAFE/CAUTION/DANGER/RECOVER/ESCAPE)
- `choose(stateVec, candidates, ctx)` → `{ id, scores, usedModel, fellBack }`
- `loadWeights(agentId?)` → carrega `reports/aiworld-weights/weights-<agent>.json`
  ou `weights-shared.json` (best-effort; `weights: null` se ausente/corrupto).
- `saveWeights(agentId?, dir?)` → persiste o artifact (usado pelo offline training step).
- `weights: null` (sem treino) = espelho do baseline; com treino aplica bias por contexto.

Os pesos aprendidos são um **contextual bandit / preference learner** explicável:
`neuralScore(intent) = base + bias[context][intent]`, onde `bias` é a diferença entre
o reward médio daquele intent e o reward médio de todos os intents naquele contexto
(mean-centering), clampado a [-1, +1] e descontado por confiança (nº de amostras).

## Offline training step (IMPLEMENTADO)

`npm run aiworld:train [--agent Steve|Alex|shared] [--minN 5]`

1. Lê `reports/aiworld-experiences/*.jsonl` (decisões + outcomes já recolhidos pelo worker).
2. Agrega por `(contexto → intent)` o reward médio (só amostras com outcome; `minN` mínimo).
3. Escreve `reports/aiworld-weights/weights-<agent>.json` (ou `weights-shared.json`).
4. O worker, no arranque (modo `neural`/`shadow`), carrega estes pesos via `loadWeights()`
   e a `NeuralPolicy` aplica o bias por contexto em `scoreIntents`.

Loop fechado: **OBSERVE → REPRESENT → DECIDE (com pesos) → ACT → OUTCOME → REWARD →
STORE → TRAIN → UPDATED POLICY**. Sem RL; treino 100% offline e reproduzível.

## Modos (AIWORLD_POLICY)

| modo | executado | neural scores | risco |
|---|---|---|---|
| `deterministic` (default) | baseline | não calculados | zero |
| `shadow` | baseline | calculados + registados | zero (só observa) |
| `neural` | neural | calculados + executados | baixo (fallback em falha) |

## Fallback behavior (invariantes de segurança)

Independentemente do modo:
- ações impossíveis / fora do domínio → rejeitadas pelo planner (intacto).
- ações perigosas → continuam a passar pelas regras de survival/segurança (intacto).
- NaN/Infinity/outliers no state vector ou scores → clamp + fallback para baseline.
- ausência de modelo (`weights: null`) → espelho do baseline (não é "fallback", é o default seguro).
- erro de inferência → `try/catch` no `recordDecisionExperience` + `scoreIntents` devolve `fellBack:true`.
- erro da policy → não pode derrubar o NPC nem o servidor.
- `deterministic` é behavioralmente compatível com o sistema atual (não toca em movimento/câmara/execução/CONSULT_LLM).

## Métricas (desde o commit 1)

`aiworld_policy_disagreement_count, aiworld_policy_fallback_count, aiworld_goal_completed_count,
aiworld_stall_count, aiworld_recovery_success_count, aiworld_unnecessary_damage_count,
aiworld_experience_recorded_count, aiworld_reward_per_episode (histogram),
aiworld_goal_completion_time_ms (histogram)`.

Para comparar A/B mais tarde: deaths/NPC-hour, goals/NPC-hour, stalls/NPC-hour extraídos
dos logs + estas métricas.

## Testes

`test/neural-policy.test.js` cobre: encodeState (bounds/NaN/clamps), invariantes de segurança
(deterministic mirror, rejeição de NaN/empty, clamp out-of-range, shadow computes without control,
missing model → mirror), experience-store (record→outcome→reward→persist), reward configurable,
buildExperience context richness.

## Próximos passos

1. **Coletar mais dados** em corridas reais (shadow/neural mode) para enriquecer o dataset.
2. **Analisar qualidade** do dataset: cobertura de estados, diversidade de outcomes,
   taxa de disagreement neural vs determinístico, estabilidade dos pesos entre runs.
3. **Decidir evolução do modelo com base nos dados**, não por preferência:
   regressão/preferência | MLP | ranking model | contextual bandit (atual) | (eventualmente) RL.
4. **Offline training step** — **IMPLEMENTADO** (`scripts/aiworld-train.js`):
   lê JSONL → agrega (contexto→intent) → escreve `weights-<agent>.json` → carregado por
   `NeuralPolicy.loadWeights`. Re-executar periodicamente (ex: cron) para refinar a policy.
5. **Shared policy**: treinar uma única policy (`weights-shared.json`) e injetá-la em todos
   os NPCs; manter memória/personalidade/objetivos individuais. Já suportado (modo `shared`).
6. **Similarity retrieval** (spec "reconhecer situações semelhantes"): usar o state vector
   para encontrar experiências passadas semanticamente próximas e influenciar a decisão.

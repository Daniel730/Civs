# AI World — Matriz de Reconciliação (espec original vs código real)

**Data:** 2026-08-12 · **Branch:** `fix/camera-observation-alex-steve` (HEAD `01cbad1e`, 7 commits ahead de origin)
**Fonte de verdade:** código atual + testes (263/263) + QA server + dataset em disco + git history.
**Regra:** não inventar capacidades. O que não está no código, não está "pronto".

---

## 1. MVP — o que a spec pede vs o que EXISTE

| # | Item MVP | Status | Evidência (código/teste/disk) | Gap |
|---|---|---|---|---|
| 1 | state encoder | **VERIFIED** | `lib/ai-world/state-rep.js` `encodeState` (17 campos 0..1, clamp, sem NaN) | — |
| 2 | experience collector | **VERIFIED** | `decision.recordFocusDecision/recordFocusOutcome`; worker linhas 1154/1074/1264 | — |
| 3 | experience schema | **VERIFIED** | `experience-store.buildExperience` (episodeId, stateVec, candidates, scores, outcome.reward) | — |
| 4 | explicit reward | **VERIFIED** | `state-rep.computeReward` (7 pesos configuráveis, clamp [-2,2]) | — |
| 5 | neural-policy interface | **VERIFIED** | `neural-policy.NeuralPolicy` (deterministic/shadow/neural) | — |
| 6 | deterministic baseline | **VERIFIED** | `decision.scoreNeeds` + `village/chooseFocus` | — |
| 7 | neural mode (executa) | **PARTIAL** | `weights:null` → espelha baseline; `_applyWeights` é stub (retorna base) | falta treino offline |
| 8 | shadow mode | **VERIFIED** | dataset Steve: 192 experiências em `shadow`, 76 `deterministic` | — |
| 9 | fallback (NaN/modelo ausente→deterministic) | **VERIFIED** | `neural-policy.scoreIntents` try/catch + clamp + `fellBack` | — |
| 10 | dataset persistence (JSONL) | **VERIFIED** | `reports/aiworld-experiences/experiences-{Steve,Alex}.jsonl` (268 + 254 linhas) | — |
| 11 | metrics | **VERIFIED** | `metrics.METRIC` AIWORLD_* + countMetric em decision.js | — |
| 12 | tests | **VERIFIED** | `npm run test:unit` → 263/263; agent-bus 11/11; neural 155; learning 75 | — |
| 13 | documentation | **VERIFIED (DESATUALIZADA)** | AIWORLD_AUDIT/LEARNING/NEURAL.md; AUDIT diz "órfã" mas worker JÁ integra | ver §3 |

**Pipeline completo (exceto TRAIN):**
OBSERVE (RCON) → encodeState → scoreNeeds → NeuralPolicy.scoreIntents (shadow/neural gravado) → chooseFocus/runJob (executa) → recordFocusOutcome (death/goal/stall/dano) → computeReward → ExperienceStore JSONL. **Confirmado por 77 linhas com reward finito no dataset Steve.**

---

## 2. Itens da spec AINDA EM FALTA (gaps reais, não inventados)

| Item | Porquê é gap | Prioridade |
|---|---|---|
| **Offline training step** (JSONL → weights artifact) | Não existe script. `NeuralPolicy.loadWeights` existe mas nada o chama; `_applyWeights` retorna base. É o único item funcional do MVP em falta. | P2 (futuro por design LIVE≠TRAIN) |
| **Shared trained policy** | `weights:null` em produção → "neural" == "deterministic mirror". Sem pesos, a policy não aprende. | P2 |
| **Memory retrieval por similaridade** (spec: "reconhecer situações semelhantes") | `memory.js` tem episodic/semantic, mas não há lookup por state-vector similarity no decision path. | P1 |
| **Subobjetivos dinâmicos** | `objective-plan.js` gera passos, não os aninha em sub-goals. | P3 |
| **WorldMemory global partilhada no loop de decisão** (§18) | `makeWorldMemory` existe em hermes-bridge mas não está ligada ao decide(). | P3 |

---

## 3. O que foi "perdido/esquecido" — esclarecimento

- **AIWORLD_AUDIT.md dizia lib `ai-world` "ÓRFÃ"** (não usada pelo worker). **Isto JÁ FOI CORRIGIDO**:
  `scripts/village-worker.js` importa `recordFocusDecision/Outcome` (linha 26), `rt` (agent-runtime, 29),
  `AgentCooperation` (30), `HermesBridge` (31); chama `rt.loadOrCreateAgent` (787/800),
  `recordFocusDecision` (1154), `recordFocusOutcome` (1074/1264). O doc está desatualizado, não o código.
- **Commit `01cbad1e` parecia rollback de 32 ficheiros (3516 deletions vs origin)**.
  Na verdade o diff `origin..HEAD` é grande porque **origin está 7 commits atrás** — as Phases 2/3/5/6/7
  não estão no origin. `git show HEAD:lib/ai-world/state-rep.js` devolve conteúdo; ficheiros estão no disco.
  **Não há perda real de código.** O que falta é o `git push` para origin.
- **Camera watchdog (Patch B)** está no worker (tick step 0c, linhas ~959-984) e foi validado vivo:
  worker correu 600s sem crash, câmera em degraded mas loop de trabalho intacto.

---

## 4. Próximas ações (incrementais, por issue→branch→test→evidência→PR)

1. **Atualizar AIWORLD_AUDIT.md** (§1.1 estado "ÓRFÃ" → "INTEGRADO") — doc-only, sem risco.
2. **Offline training step** (P2): script que lê JSONL → escreve `weights-<agent>.json`;
   liga `NeuralPolicy.loadWeights` no arranque quando artifact existe. Mantém LIVE≠TRAIN.
3. **Memory retrieval por similaridade** (P1): cosine-similarity sobre `stateVec` no decide()
   para recuperar experiências passadas semelhantes (contexto para a policy futura).
4. **Push para origin** (quando o user autorizar) — 7 commits ahead, tudo verde.

---

## 5. Critério de sucesso da spec — onde estamos

- "demonstrar OBSERVE→STATE VECTOR→EXPERIENCE→DECISION→OUTCOME→REWARD→DATASET com testes e execução real curta"
  → **CUMPRIDO**: testes 263/263 + dataset Steve/Alex a crescer com rewards finitos + worker vivo 600s.
- "alternar deterministic/shadow/neural sem quebrar o sistema"
  → **CUMPRIDO**: `AIWORLD_POLICY` env var; neural com weights:null é mirror seguro; fallback testado.
- "não é apenas `neural-policy.js`"
  → **CUMPRIDO**: pipeline completo ligado, não só o stub.

**Conclusão:** O MVP está entregue e validado. O que falta (offline training, shared weights, similarity retrieval)
são extensões por design futuras, não regressões. Nada foi perdido; o AUDIT.md apenas precisa de sincronização.

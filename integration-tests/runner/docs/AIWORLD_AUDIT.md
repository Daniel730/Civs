# AI World — Auditoria de Arquitetura (Phase 1)

**Data:** 2026-08-11 · **Branch:** `fix/camera-observation-alex-steve`
**Objetivo do doc original:** transformar os NPCs num Living AI World (memória persistente,
aprendizagem, objetivos, exploração, construção, cooperação, Hermes bridge, Cam cinematográfico).

---

## 0. Conclusão executiva

> **A maior parte do que o brief pede JÁ EXISTE como módulos em `lib/ai-world/` — mas está
> ÓRFÃ.** O loop vivo (`scripts/village-worker.js`) NÃO importa `createAgent`, `createQuestLoop`,
> `createMemory`, `createGoal`, `persistAgent`. Ele usa uma arquitetura paralela mais antiga
> (`nextJob`/`chooseFocus`/`construction` em `lib/village/`) onde eu (Hermes) fui colando o
> commitment layer e o survival fix.

**Implicação:** não reescrever nada. O trabalho real da Phase 1→4 é **INTEGRAR** a biblioteca
`ai-world` existente no loop vivo, e construir o que FALTA (Hermes bridge, cooperação,
detecção de espaço fechado na câmara). Isto é reaproveitamento massivo, não greenfield.

---

## 1. Mapa de componentes existentes (e estado)

### 1.1 `lib/ai-world/` — a biblioteca viva (ÓRFÃ)
| Módulo | O que faz | Mapeia para o brief | Estado |
|---|---|---|---|
| `state.js` | `createAgent` (identity, needs, goals, relationships, skills, memory, guard, AUTONOMY ladder) + `saveAgent`/`loadAgent` (JSON em disco) | AgentMemory raiz, persistência | **Pronto** |
| `memory.js` | `createMemory` bounded: working/episodic/semantic/social + caps + importância + esquecimento por sort | §3 Memória individual, §4 importância/esquecimento | **Pronto** (faltam spatial/skill sub-buckets) |
| `goals.js` | `createGoal` (life/long/medium/current), `setCurrentGoal`, `completeCurrentGoal`, `reconsiderGoals` (replan por perigo/fome) | §6 Objetivos, §7 Replan | **Pronto** |
| `perception.js` | `buildObservation` → LOCAL/REGIONAL/KNOWN (não despeja mundo no LLM) | §Perception | **Pronto** |
| `world-adapter.js` | `ingestWorldPerception` → POIs/regiões para semantic memory | §8 KnownWorld, §18 WorldMemory | **Pronto** (parcial) |
| `events.js` | `WorldEvent` + `EVENT` enum (observe/goal/plan/action/quest/replan/social/construction/memory) + OTel | §28 Eventos, §33 Observabilidade | **Pronto** |
| `decision.js` | `scoreNeeds` (personality-weighted intents), `decide`, `recordDecisionExperience`, `recordFocusDecision`, `recordFocusOutcome` | §5 Learning, §12 Hermes triggers | **Pronto** |
| `intention-cache.js` | `IntentionCache` (TTL 20-60s, contextKey) + `AntiStall` ladder (CONTINUE→LOCAL_RECOVERY→REPLAN→CONSULT_LLM→ABANDON_GOAL) | §15 cooldown/prioridade, §26 hysteresis | **Pronto** |
| `consult-planner.js` | `ConsultGate` (só consulta em CONSULT_LLM, 1×/goal, cooldown 90s) + `StubPlanner` + `plannerFromEnv` | §15 gatilhos Hermes, §31 fallback | **Pronto** (planner stub) |
| `personality.js` | `PROFESSIONS` (builder/merchant/farmer/explorer/guard/...), `applyPersonality` (traits influenciam score — nunca cosmético) | Personalidade dos NPCs | **Pronto** |
| `anti-stupid.js` | `Guard`: retry budgets, stuck detection, cooldowns, plan invalidation, oscillation detect | §31 falhas | **Pronto** |
| `objective-plan.js` | `planObjective`/`planQuest` → RPG objective → capability intents (gather/combat/travel) | §9 Construção, §10 Mineração (como planos) | **Pronto** (parcial; skill_xp blocked) |
| `quest-loop.js` | `createQuestLoop` FSM (observe→decide→evaluate→accept→plan→act→progress→complete→remember→replan→fail) com event-driven replan | §7 Planeamento/Replan, §5 loop | **Pronto** (vertical slice) |
| `mine-executor.js` | `executeMineObjective` — loop determinístico de mineração (find/move/break, progress via quest_detail) | §10 Mineração | **Pronto** |
| `quest-eval.js` | `selectQuest`/`evaluateQuest` (score de aceitação) | §Decisão de quests | **Pronto** (não lido em detalhe) |
| `state-rep.js` | `encodeState` (17 campos normalizados) | §State vector | **Pronto** (MVP neural) |
| `neural-policy.js` | `NeuralPolicy` stub (mirror do baseline, shadow mode) — **sem RL** | §5 Aprendizagem | **Pronto** (MVP) |
| `experience-store.js` | `ExperienceStore` JSONL append-only por agente | §5 Dataset | **Pronto** (MVP) |
| `persistence.js` | `persistAgent`/`restoreAgent` (snapshot seletivo: ephemeral vs persistent) | §3 sobrevive restart, §31 degraded | **Pronto** (mas NUNCA chamado pelo worker vivo) |

### 1.2 `lib/observation/` — câmara (PARCIALMENTE usada)
| Módulo | O que faz | Mapeia para o brief | Estado |
|---|---|---|---|
| `cinematic.js` | `CinematicDirector` FSM (OBSERVING/TRANSITIONING/ESTABLISHING/FOLLOWING/RECOVERING/...) + `_observe` (agora com grace-period) | §19 Estados, §31 falhas | **Usado** (ligado) |
| `subject-scoring.js` | `SubjectDirector` — hysteresis, minDwell, event priority, novelty penalty | §26 Evitar câmara irritante, §25 scoring | **Usado** (ligado) |
| `shots.js` | `SHOTS` (establishing/wide/medium/over_shoulder/close/low/profile/orbit/top_down/reaction) + `ACTIVITY_ROTATIONS` (por atividade) | §20 Estados cinematográficos | **Usado** (ligado) |
| `viewer-follow.js` | `ViewerFollowLoop` — re-assert `/spectate Cam` periodicamente | Cam follow | **Usado** (ligado) |
| `director-fsm.js` | FSM states + transições validadas | §20 | **Usado** |
| `director.js` | `ObservationDirector` (legacy path) | - | alternativo |

**FALTA na câmara (§21-24, §27):** deteção de espaço fechado (enclosed/interior/exterior),
panoramic mode, cinematic memory (onde já filmou), enclosed→first_person transition. O
`SubjectDirector` e `shots.js` têm GRAMÁRICA para isso (`close`, `low`, `profile`, `orbit`)
mas NÃO há deteção de contexto espacial que os acione por "entrou numa caverna".

### 1.3 `lib/village/` — arquitetura antiga (USADA pelo worker vivo)
`nextJob`, `chooseFocus`, `workCoords`, `SITES`, `siteForJob`, `construction` (engine/blueprint/
visualCritic/validate/repair/site/memory), `walk`, `terrain`, `stockpile`, `jobs`, `focus`, `index`.
→ Isto é o que o `village-worker.js` realmente executa hoje. O commitment layer que eu fiz
(`chooseObjective`) está AQUI, não no `ai-world`.

### 1.4 `lib/` raiz
- `harness.js` — `Harness` RCON (já é a `MinecraftCommandInterface` do brief §13! Comandos
  `/cv`, `/test ...`, `item replace`, `tp`, etc. via RCON). **É a abstração pedida.**
- `actor.js` — `RawKeepAliveActor` (`minecraft-protocol` client, reconexão auto, `ensureOnline`).
- `camera.js` — `SpectatorCamera` (Cam player, `cam_shot` capability).
- `capabilities.js` — `Capabilities` (cam_shot, observe, give_item, break_block, find_block, etc).
- `metrics.js` — `METRIC` enum (inclui `AI_WORLD_*`, `CAMERA_*`, `NO_PROGRESS`, etc).
- `telemetry.js` — OTel spans.

### 1.5 Hermes bridge
**NÃO EXISTE** ponte Hermes↔NPC (§12-17, §35). O `consult-planner.js` tem o *gate* (quando
consultar) mas o `planner` real (que chamaria o Hermes/LLM) é um `StubPlanner`. O brief quer
uma ponte bidirecional estruturada (AI_QUERY/AI_RESPONSE protocolo). **ISTO É GREENFIELD.**

---

## 2. O que o brief pede vs o que existe

| Brief § | Pedido | Estado atual | Ação |
|---|---|---|---|
| §3 | AgentMemory (episodic/semantic/social/skill/spatial/goals) | `memory.js` (episodic/semantic/social) + `goals.js` (life/long/medium/current) | **Expandir** memory.js para skill/spatial sub-buckets |
| §4 | Importância/recência/consolidação/esquecimento/dedupe | `memory.js` caps+sort já faz | Quase pronto; adicionar dedupe + consolidação |
| §5 | Learning: Experience→Outcome→Eval→Memory→Policy | `experience-store` + `decision.recordFocusOutcome` + `neural-policy` (mirror) | **Integrar** no loop vivo; sem RL |
| §6 | Objetivos imediatos/médio/longo + subobjetivos | `goals.js` + `objective-plan.js` | **Integrar**; adicionar geração de subobjetivos dinâmicos |
| §7 | Planeamento + replan por mudança de mundo | `quest-loop.js` (REPLAN por danger/timeout) + `AntiStall` | Quase pronto |
| §8 | KnownWorld / exploração motivada | `world-adapter.js` (POIs) + `perception` | **Expandir** para spatial memory de exploração |
| §9 | Construção progressiva persistente | `village/construction/*` (engine/blueprint/validate/repair) | **Integrar** com goals (já parcial) |
| §10 | Mineração gera knowledge | `mine-executor.js` | **Expandir** para gravar "mapa mental" de minas na semantic memory |
| §11 | NPC-NPC comunicação (`AgentMessage`) | `events.js` (SOCIAL event) + `memory.rememberPerson` | **Greenfield**: `AgentMessage` bus + world knowledge share |
| §12-17 | Hermes bridge bidirecional + protocolo + gatilhos | `consult-planner.js` (gate só) | **Greenfield**: bridge real (ver §3 abaixo) |
| §18 | WorldMemory compartilhada (pode estar errada) | `world-adapter` (por-agent semantic) | **Greenfield**: WorldMemory global partilhada |
| §19-27 | Cam cinematográfico (enclosed/panoramic/memory/scoring) | `cinematic`+`shots`+`subject-scoring` (gramática pronta) | **Greenfield**: deteção de contexto espacial |
| §28-29 | WorldEvent + mundo vivo | `events.js` (enum pronto) | **Integrar** eventos no loop vivo |
| §30 | Performance (tick loop ≠ decision loop ≠ LLM loop) | `IntentionCache` TTL + `ConsultGate` cooldown | Pronto por desenho |
| §31 | Falhas (Hermes down / memory down / Cam fail) | `try/catch` em todo o lado; `consult-planner` default-off | Pronto por desenho |
| §32-34 | Testes + observabilidade | `test/*` (131 nightshift) + `metrics.js` + `events.js` OTel | Expandir para os novos módulos |
| §35 | Critério de sucesso E2E | - | Construir cenário E2E |

---

## 3. Plano de integração (não reescrever)

### Fase A — Ligar a biblioteca órfã ao loop vivo (Phase 2-4 do brief)
1. `connectActor` já cria o player. **Substituir** o `state` local do worker por `createAgent`
   + `persistAgent`/`restoreAgent` (ficheiro `reports/agents/<name>.json`).
2. No início de cada tick: `buildObservation` (já existe) → alimenta `decide`/`scoreNeeds`.
3. `createQuestLoop` (FSM completa) substitui o `runJob`/`chooseObjective` manual.
   → Os objetivos passam a ser `goals.js` + `objective-plan.js` + `quest-loop.js`.
4. `rememberEpisode`/`rememberFact` chamados nos pontos de evento (já há hooks em `quest-loop`).
5. `AntiStall` + `IntentionCache` JÁ estão no worker (importados) — só faltam ligar ao `goals`.

### Fase B — Expansão de memória (Phase 2)
- `memory.js`: adicionar `spatial` (villages/mines/caves/paths) e `skill` (mining/building/...)
  sub-buckets, dedupe por hash de conteúdo, consolidação periódica (merge de episódios baixos).

### Fase C — Hermes Bridge (Phase 5) [GREENFIELD]
- `lib/ai-world/hermes-bridge.js`: `MinecraftAIQuery`/`MinecraftAIResponse` protocolo (§14).
- `ConsultGate.maybeConsult` já decide *quando*; o bridge decide *como* chamar Hermes.
- Triggers (§15): confidence<threshold, novelty>threshold, goal_conflict, high_impact,
  failed_attempts>=N, explicit ask. Cooldown/cache/priority/timeout/fallback local.
- Bidirecional (§16): Hermes pode perguntar NPCs (`hermesAsk(agent, q)` → resposta da memória).

### Fase D — NPC Cooperation (Phase 6) [GREENFIELD]
- `lib/ai-world/agent-bus.js`: `AgentMessage` (sender/receiver/intent/content/priority/ts/ctx).
- `rememberPerson` já existe; adicionar share de `semantic` (POIs/recursos) entre agentes.

### Fase E — Cinematic Director enh (Phase 7) [GREENFIELD parcial]
- `cinematic.js`: deteção de espaço fechado (via `observe` block_below/ceiling + raycast simples),
  `panoramic` mode (elevação + open area), `CinematicMemory` (onde já filmou).
- `shots.js` já tem `close`/`low`/`orbit`/`profile` — só acionar por contexto.

### Fase F — WorldMemory (Phase 4/18) [GREENFIELD]
- `lib/ai-world/world-memory.js`: store global (JSON em disco) de descobertas, pode estar stale.

---

## 4. Decisões arquiteturais tomadas (a confirmar com o user)
1. **Não reescrever** `lib/ai-world`. Integrar. (Regra do brief §38 + audit.)
2. **Hermes bridge é o único greenfield grande.** Tudo o resto é integração/expansão.
3. **`harness.js` JÁ é a `MinecraftCommandInterface`** (§13) — não criar abstração nova;
   o bridge fala com o Hermes (LLM) por cima do `harness`/RCON que já existe.
4. **Sem RL** (regra do MVP neural + brief §5). Aprendizagem = adaptação de política/local.
5. **Persistência:** agentes em `reports/agents/<name>.json` (já há padrão `STATE_FILE`/`MEMORY_PATH`).

---

## 5. Gaps críticos (o que REALMENTE falta)
1. **Loop vivo não usa `ai-world`** → NPCs não têm memória/objetivos persistentes reais hoje.
2. **Hermes bridge** → inexistente (só gate stub).
3. **Cooperação NPC-NPC** → inexistente (só `rememberPerson` unidirecional).
4. **WorldMemory global** → inexistente.
5. **Cam: deteção de espaço fechado/panoramic/memory** → gramática existe, deteção não.
6. **Subobjetivos dinâmicos** → `objective-plan` gera passos mas não os aninha em sub-goals.

## 6. O que NÃO mexer (já resolve o problema)
- `memory.js`, `goals.js`, `events.js`, `perception.js`, `decision.js`, `intention-cache.js`,
  `consult-planner.js`, `personality.js`, `anti-stupid.js`, `quest-loop.js`, `mine-executor.js`,
  `objective-plan.js`, `state-rep.js`, `neural-policy.js`, `experience-store.js`, `persistence.js`
  → todos prontos, só órfãos.
- `harness.js` (já é a command interface), `actor.js` (reconexão ok), `cinematic.js`+`shots.js`+
  `subject-scoring.js` (gramática de câmara pronta), `viewer-follow.js`.

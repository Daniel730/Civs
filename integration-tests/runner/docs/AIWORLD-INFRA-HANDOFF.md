# Civs AI World — Infraestrutura de NPCs Player-Like (Prompt de Handoff p/ outra IA)

> Gerado por Neo em 2026-08-18. Baseado em leitura direta de código (`integration-tests/runner/`)
> e em evidência de execução in-game (logs `village-worker-qa*.log` + `aiworld-deterministic-dataset.jsonl`).

## 0. O PROBLEMA CENTRAL (o que o usuário quer)
O usuário (Daniel730) exige que os NPCs **Steve/Alex sejam PLAYER-LIKE**: andam/swim/jump de verdade,
quebram com a ferramenta certa, pegam drops, craftam do próprio inventário, percebem o mundo.
**PROIBIDO**: godmode, cheat, teleport durante o trabalho, terraformar no vácuo/ar.
Servidor de QA (192.168.152.149:25576 RCON, MC :25566) = produção p/ o usuário → **não logar / não RCON-write sem autorização**.
Validação in-game é feita pelo próprio usuário; a IA aqui só faz leitura passiva (observe/read-only).

## 1. TOPOLOGIA / ONDE AS COISAS MORAM
```
Civs-1.11.6/integration-tests/runner/            <- RAIZ do runner (node, sem build)
├── scripts/village-worker.js                     <- ENTRYPOINT do NPC (2787→2860 linhas). Loop de tick.
├── scripts/aiworld-train.js                      <- OFFLINE training step (LÊ dataset JSONL → pesos)
├── lib/
│   ├── harness.js                                <- RCON/MC wrapper (host 127.0.0.1/192.168.152.149:25576, pw civsqa)
│   ├── village/walk.js                           <- walkTo() = locomoção server-side (A* walk_path + fallback)
│   ├── village/job-runner.js                     <- JobRunner: gather/torch/miner/lumberjack/farmer/builder incremental
│   ├── survival/execute.js                       <- executeSurvival(): recover/flee/defend (handler de risco)
│   ├── survival/threat.js                        <- SurvivalMonitor (classifica SAFE/CAUTION/ESCAPE/DANGER)
│   ├── crafting.js, tool-check.js, inventory-diff.js, combat-log.js, agent-events.js
│   ├── observation/, camera/ (CinematicDirector, SpectatorCamera, ViewerFollowLoop)
│   └── metrics.js                                <- registry de métricas (compartilhado com o pacote)
├── node_modules/@daniel730/aiworld/              <- PACOTE DO USUÁRIO (Daniel730/aiworld no GitHub)
│   ├── decision.js   (recordFocusDecision/Outcome, decide, selfTrain.noteOutcome)
│   ├── intention-cache.js (AntiStall), experience-store.js, neural-policy.js, state-rep.js
│   ├── self-train.js  ← BUG: resolve TRAIN_SCRIPT = ROOT/scripts/aiworld-train.js
│   └── metrics/index.js ← DELEGA p/ lib/metrics.js do runner (registry único)
├── reports/
│   ├── aiworld-deterministic-dataset.jsonl       <- gravado com DETERMINISTIC_MODE=1 (observação+decisão+invariante)
│   ├── aiworld-experiences/experiences-<agent>.jsonl  <- gravação de experiência p/ learning
│   └── village-worker-qa*.log                    <- stdout/jsonl do worker
└── test/  (368 testes, 368 passando)
```

## 2. FLUXO DE UM TICK (village-worker.js)
1. `assess` (SurvivalMonitor) → estado SAFE/CAUTION/ESCAPE/DANGER.
2. Se ESCAPE/DANGER → `executeSurvival()` (flee/recover/defend). Se handled, retorna (não roda work loop).
3. Caso contrário → `chooseFocus()` → `runJobOrRunner()` → `_JobRunner.runJobStep()` (incremental, respeita budgetMs).
4. Cada step do job chama `safeWalk()` (wrapper de `walkTo`) ou `breakBlock`/`placeBlock`/`gather`.
5. Se `DETERMINISTIC_MODE=1`: `recordDeterministicObservation()` + `detectInvariants()` gravam no dataset JSONL.
6. `recordFocusDecision()` / `recordFocusOutcome()` (pacote) gravam experiência p/ learning; `selfTrain.noteOutcome()` dispara train offline.

## 3. LOCOMOÇÃO (o maior dorél)
- `walkTo()` em `lib/village/walk.js`: usa `cap.act(actor,'walk_path',x,y,z,...)` (A* server-side Paper).
  - `runPathLeg()`: roda o path e POLLA status; aborta em hazard (`in_water`/`suffocating`) → `HAZARD_ABORTED`.
  - Pre-flight: se cabeça do alvo não é ar, sobe `goal.y` até +4 (anti "GTA SA bug" / suffocation). **ESSE bump pode jogar o alvo pro ar se o corpo já estiver no ar.**
  - `allowTeleport:false` é HARD no `safeWalk` (player-like). Mas `executeSurvival` (flee/recover) AINDA teleporta como last-resort.
- `safeWalk()` em `village-worker.js`: anel de offsets [0,0]..[±6] + diag; water-aware (re-rota p/ terra); hop-back em `stuck`.
- `walk_path_hops` (B3, walk.js): divide distância > recoverDistance em hops; CORRIGIDO (B2) p/ tolerar hops parciais.

## 4. SURVIVAL / FLEE (onde o loop de afogamento vivia)
- `executeSurvival` `flee` (execute.js): se `in_water`/`drowning`, faz `jump` ×12 (swim_up); se não surfacir,
  `findNearestDryLand()` + teleport p/ terra (last resort). **BUG HISTÓRICO**: `findNearestDryLand` só via y=60
  e retornava y=61 → em riverbank elevado teleportava PRA DENTRO da água → loop infinito drown→teleport→drown.
  **CORRIGIDO (patch C, commit df256fa6)**: scan da altura real do corpo + retorna superfície de terra + adota
  como novo `cfg.origin`. MAS: o fallback "sem terra próxima" sobe +2 e às vezes deixa o NPC no AR (y=71/72)
  fazendo place no vácuo → quebra player-like.

## 5. LEARNING / NEURAL (modo deterministic | neural | shadow)
- `decision.js`: `recordFocusDecision` grava episode; `recordFocusOutcome` anexa reward (computeReward).
- `experience-store.js`: JSONL append-only em `reports/aiworld-experiences/`. DEFAULT_DIR corrigido (commit e962849)
  p/ apontar p/ `runner/reports/` (antes escrevia em `node_modules/@daniel730/reports`).
- `scripts/aiworld-train.js` (FORA do pacote): agrega dataset → pesos JSON. Lido por `neural-policy.js`.
- **BUG self-train (ainda aberto)**: `node_modules/@daniel730/aiworld/self-train.js` faz
  `TRAIN_SCRIPT = ROOT/scripts/aiworld-train.js` onde ROOT = o pacote. Caminho real é
  `runner/scripts/aiworld-train.js`. Resultado: `[self-train] train step failed: Cannot find module`.
  Não quebra o worker, mas polui o log e o loop de learning offline não fecha.

## 6. BUGS CONHECIDOS / PENDENTES (evidência de qa4, tick 39589-39592)
1. **NPC no ar terraformando** (y=71/72, place de oak_fence em (5202,72,5171)): o `drown_surface_teleport`
   subiu demais / `pre-flight` do walkTo empilhou goal.y. Steve parou de se mover e só faz remove/place no vácuo.
   → Quebra a promessa player-like. **Prioridade alta.**
2. **walk_threw / start_not_standable**: safeWalk falhando sistematicamente quando o alvo está no ar
   (`walkTo` lança ou o pre-flight não acha coluna 2-blocos-livre acima do alvo no ar).
3. **self-train quebrado** (caminho do TRAIN_SCRIPT) — ver item 5.
4. **Inventário duplicado**: dataset mostra 33× DIAMOND_SWORD — `diffInventory`/`observe` duplicando item
   (bug de observação, não crítico p/ movimento mas suja o dataset de learning).
5. **town NpcPad does not exist**: worker loga `NEEDS_PLAYER_FOUNDING` — o assentamento não foi fundado;
   algumas features (village-builder) dependem dele.

## 7. COMO RODAR (usuário, in-game)
```
cd integration-tests/runner
RCON_HOST=192.168.152.149 RCON_PORT=25576 SURFACE_FALLBACK=1 DETERMINISTIC_MODE=1 \
node scripts/village-worker.js 2>&1 | tee -a reports/village-worker-qaN.log
```
Monitoramento passivo (IA): `tail -f reports/aiworld-deterministic-dataset.jsonl` + `node scripts/observe-e2e.js`.

## 8. O QUE A OUTRA IA DEVE MELHORAR (pedido do usuário)
Manter o NPC **player-like** e acabar com os 2 modos que quebram isso:
(a) **Nunca teleportar pro ar / terraformar no vácuo** — se o body está submerso e não há terra,
    subir só o suficiente p/ surfacir e então WALK (não place no ar); ou usar walk_path real pra sair da água.
(b) **safeWalk/walkTo robusto em terreno irregular** — o pre-flight de goal.y não deve empilhar até achar ar
    se o alvo já está no ar; deve clampar perto da superfície real do terreno.
(c) **Consertar self-train** — resolver o caminho de `aiworld-train.js` (relativo ao runner, não ao pacote)
    ou expor via env/option.
(d) **Inventário**: deduplicar DIAMOND_SWORD no observe/diff.
(e) Manter DETERMINISTIC_MODE e o dataset JSONL como fonte de verdade p/ validar offline.

## 9. COMMITS RELEVANTES (branch fix/camera-observation-alex-steve)
- 7d8143a1: surfaceFallback spawn-safe + deterministic mode
- b375004c: JobRunner integration tests
- 50493f02: Locomotion B2+B1 (walk_path_hops + safeWalk water-aware)
- df256fa6: Locomotion C (break drown→teleport→drown loop)
- e962849 (repo C:/Users/Danie/aiworld): seed do pacote + fix metrics/experience-store

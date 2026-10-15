# AI World — Documentation Index (MAPA MESTRE)

> **Este é o ponto de entrada.** Qualquer agente (Hermes, subagent, ou eu mesmo em sessão futura)
> lê este arquivo PRIMEIRO e depois os mapas por camada.
>
> **REGRAS DE VERDADE (lidas do usuário Daniel, 2026-08-18):**
> 1. A documentação NÃO é fonte de verdade absoluta. Ela é **histórico de discussões** ao longo do projeto.
> 2. Onde um doc divergiu do que a gente decidiu NA PRÁTICA, **o código + a decisão recente vencem**.
> 3. Marcamos `STALE` nos pontos onde o doc ficou para trás, e `CURRENT` no estado real hoje.

---

## Como navegar

| Arquivo | O que contém | Quando ler |
|---|---|---|
| **AIWORLD-INDEX.md** (este) | Mapa mestre + regras de verdade + status por decisão | SEMPRE primeiro |
| AIWORLD-BODY-MAP.md | `lib/village/` — waypoint selector, walk.js, job-runner, terrain | Ao mexer em locomoção/objetivos |
| AIWORLD-SURVIVAL-MAP.md | `lib/survival/execute.js`, `actor.js`, `harness.js`, `actor-mineflayer.js` | Ao mexer em teleport/recovery/Mineflayer |
| AIWORLD-WORKER-MAP.md | `scripts/village-worker.js` — main, connectActor, continuity, tick, ENV | Ao mexer no loop vivo |
| AIWORLD-AUDIT.md | Audit original (2026-08-11) — módulos `lib/ai-world/` órfãos | Contexto histórico da arquitetura |
| AIWORLD-STATUS.md | Status honesto (2026-08-13) — **STALE em ports/suite** | Histórico, ver CURRENT abaixo |
| AIWORLD-BRAIN-CONTRACT.md | Contrato brain↔body — **STALE em teleport-home (D-AP-021)** | Histórico, ver CURRENT |
| AIWORLD-COORD.md | Board de coord brain↔body — **STALE em teleport-home** | Histórico, ver CURRENT |
| AIWORLD-LEARNING.md | Learning layer (Phase 3) — está atualizado | Ao mexer em learning/self-train |
| AIWORLD_NEURAL.md | Neural policy (stub, sem RL) | Ao mexer em policy |
| AIWORLD-INFRA-HANDOFF.md | Handoff prompt p/ outra IA | Ao pedir ajuda externa |

---

## Estado CURRENT (2026-08-18, após Fase 1 / 1.5) — o que vale HOJE

### Locomoção / Teleport (decisão do usuário: "sem teleport, player-like")
- **Fase 1 (commit `efb4f9e1`):** removido o `actor.teleport(cfg.origin...)` do `connectActor` (spawn teleport). Steve nasce onde o servidor manda.
- **Fase 1.5 (commit `1da7ce79`):** removido o `returnTeleport` do `execute.js` recover (survival). Quando o Steve morre, ele renasce no spawn natural do servidor; o worker adota essa posição via `continuity_origin` no tick seguinte. **Sem teleport de volta pra origin fixo.**
- **`inspectBody` (job-runner.js):** agora usa `observe` (`on_ground`, `block_below`) em vez do `execute if block` quebrado. (commit `efb4f9e1`)
- **WORK PATH:** `lib/village/walk.js` ainda usa `walk_path` (A* server-side, 3.89 b/s, sem teleport quando `allowTeleport:false`). O worker passa `allowTeleport:false` em todo work-path.
- **STALE:** `AIWORLD-COORD.md` (linha 26-28) e `AIWORLD-BRAIN-CONTRACT.md` (linha 54-56) dizem que o teleport-home é "approved architecture (D-AP-021)". **ISSO FOI REVERTIDO pela decisão do usuário (Fase 1.5): o teleport-home foi REMOVIDO.** O doc está desatualizado nesse ponto. O bug real (objective re-issuing unreachable waypoint) continua sendo do BODY selector — mas o usuário preferiu matar o teleport também, não só o re-issue.

### Ports (CURRENT — o código confirma)
- **RCON:** `192.168.152.149:25576` (não 25575). `village-worker.js` linha 159-164: "25575 was inherited from a bot-server QA profile and silently breaks".
- **MC:** `192.168.152.149:25566` (não 25565).
- **STALE:** `AIWORLD-STATUS.md` (linha 8-9) e vários scripts (`run.js`, `gateway/*`, `observe-e2e.js`) ainda usam 25575/25565 como default. O worker e o `harness.js` (linha 54) usam 25576. **O worker está certo; os outros scripts estão stale.**

### Mineflayer (CURRENT — testado 2026-08-18)
- **Fase A falhou:** Mineflayer 4.37.1 NÃO conecta em MC 26.1.2. `createBot` lança `Server version '26.1' is not supported. Latest supported version is '1.21.11'`. O `minecraft-protocol` 1.66.2 (lista '26' mas rejeita '26.1.2').
- `actor-mineflayer.js` existe como esqueleto mas reporta `available:false` em 26.1.2.
- **Conclusão:** Mineflayer real (WASD/física) só é viável se (a) baixar MC server pra 1.21.x, ou (b) aparecer versão do Mineflayer que suporte 26.1.2.

### (C) WASD via CivsTestHarness — REALITY CHECK (2026-08-18)
- `lib/capabilities.js` expõe: `sneak` (100), `sprint` (103), `jump` (106), `step forward <len>` (145). **NÃO expõe `back`/`left`/`right`.**
- O `step forward` é um **passo discreto**, não WASD contínuo.
- `walk.js` linha 5-9: o stepping loop foi testado e REJEITADO como "bot-like" (0.75 b/s, 76.5% parado, 50 RCON cmds pra 22 blocos).
- **Conclusão honesta:** "WASD real" via CivsTestHarness NÃO é viável como WASD completo (só frente+pulo+agachar+correr, e o stepping já foi testado e é pior que `walk_path`). O (C) como foi imaginado (andar como player de verdade) **não se realiza** com o CivsTestHarness atual. O caminho real pra WASD é Mineflayer (travado em 26.1.2) ou downgrade do servidor.

### Suite (CURRENT)
- `npm run test:unit` → **368/368** (2026-08-18). Vários nomes de suite no histórico (131/294/278/368) refletem crescimento ao longo do projeto.

---

## Decisões do usuário (log consolidado)
- "Por enquanto sem mineflayer" → depois "bora de mineflayer" → Fase A provou inviável em 26.1.2.
- "Steve não nasce no spawn natural / que porra de teleport" → Fase 1 removeu spawn teleport.
- "Quando mato ele volta pro mesmo espaço" → Fase 1.5 removeu returnTeleport.
- "(C) WASD via CivsTestHarness" → reality check acima mostra que não é WASD completo.
- "A documentação precisa de updates; ela não é fonte de verdade absoluta" → este índice + mapas reconciliam.

---

## O que NÃO mexer (do AIWORLD-AUDIT.md, ainda válido)
`lib/ai-world/*` (memory, goals, decision, intention-cache, consult-planner, personality,
anti-stupid, quest-loop, mine-executor, objective-plan, state-rep, neural-policy,
experience-store, persistence) — prontos, órfãos, só integrar. `harness.js` (já é a command
interface). `cinematic.js`+`shots.js`+`subject-scoring.js` (gramática de câmara).

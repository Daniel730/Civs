# Current State — Civs + Agent Platform (2026-08-17)

Labels: **FACT** (verified in repo/API/runtime) · **OBSERVED** (seen in logs/runs) · **INFERRED** · **UNKNOWN** · **TODO**

## Repository State

| Field | Value | Label |
|-------|-------|-------|
| Repo | `C:/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6` | FACT |
| Branch | `fix/camera-observation-alex-steve` | FACT |
| Remote | `origin` → `github.com/Daniel730/Civs` | FACT |
| Last healthy commit | `ac306a02` — "Steve funcional: builder no JobRunner + fix getWorldMemory + swim-up" | FACT |
| Uncommitted changes | `integration-tests/runner/lib/harness.js`, `integration-tests/runner/lib/survival/execute.js` | FACT |
| Recovery branch | `recovery/pre-hermes-audit-20260817` (created, stashed WIP) | FACT |

## Build / Test Status

| Check | Status | Notes |
|-------|--------|-------|
| `mvn -B -DskipTests compile` | **UNKNOWN** — Maven not on Windows PATH | Needs Java 25 + Maven 3.9.9 |
| `mvn -B test` | **UNKNOWN** | 427 tests, 6 skipped (Mockito 5.23.0 for Java 25) |
| Flaky test | `RegionsTests.dailyRegionShouldUpkeepDaily` | FACT — passes in isolation |

## Agent Platform Status

| Layer | Status | Label |
|-------|--------|-------|
| Harness plugin (`test-harness-plugin`) | Deployed, `/test` commands work | FACT |
| Node runner (`integration-tests/runner`) | Built, scenarios run | FACT |
| `RawKeepAliveActor` | Online on Paper 26.1.2 | FACT |
| Server-side capabilities (`/test act`) | In progress (P1) | FACT |
| RPG observe (`/test rpg ...`) | Via reflection bridge | FACT |
| Real MC 26.1.2 client | Provisioned for GUI QA | FACT |

## WSL QA Environment

| Component | Value | Label |
|-----------|-------|-------|
| Testserver path | `/home/dansilva/civs-testserver` | OBSERVED |
| RCON port | 25575 | FACT |
| RCON password | `civsqa` | OBSERVED |
| MC port | 25565 | FACT |
| Server status | **Stopped** (last stop 2026-07-17) | OBSERVED |

## Hermes Configuration (Windows Host) — UPDATED 2026-08-17

| Setting | Value | Issue |
|---------|-------|-------|
| Main model | `mistral/mistral-small-latest` (LiteLLM local `http://127.0.0.1:4000/v1`) | **Configured to avoid free-tier regression** |
| Fallback | `deepseek/deepseek-v4-flash-0731` (OpenRouter) | OK when credits available |
| Delegation | `provider: openrouter`, `model: poolside/laguna-s-2.1:free` | Points to OpenRouter free |
| Aux models | `auxiliary.vision.model: nvidia/nemotron-3-super-120b-a12b:free` | Configured |
| Compression | `compression.summary_model: nvidia/nemotron-3-super-120b-a12b:free` | Configured |
| MOA | Disabled | Was using Nous free (unstable) |
| Memory | Enabled, 2200 char limit | May be stale |
| Skills | Auto-creation nudge at 15 turns | OK |

### Model Routing (when credits return)

| Tier | Model | Use |
|------|-------|-----|
| Main/Medium | `deepseek/deepseek-v4-flash-0731` | Normal coding |
| Strong/Architect | `anthropic/claude-opus-5` | Complex reasoning |
| Cheap/Aux | `qwen/qwen3.7-flash` | Compression, vision, web |
| Fallback | `poolside/laguna-s-2.1` | Backup |

### Free-to-use config (current, no credits)

| Slot | Model | Endpoint |
|------|-------|----------|
| Main | `mistral/mistral-small-latest` | LiteLLM local `127.0.0.1:4000` |
| Delegation | `poolside/laguna-s-2.1:free` | OpenRouter (rate-limited) |
| Aux/Vision | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter (rate-limited) |

## LiteLLM Proxy (Localhost:4000)

| Model | Status | Notes |
|-------|--------|-------|
| `mistral/mistral-small-latest` | **HEALTHY** | Only working endpoint |
| `groq/llama-3.3-70b-versatile` | UNHEALTHY | Model not found (404) |
| `deepseek/deepseek-chat` | UNHEALTHY | Invalid API key (401) |
| `openrouter/deepseek/deepseek-v4-flash-0731` | UNHEALTHY | Key limit exceeded (403) |
| Free models (hy3, laguna, solar, step) | Configured in MOA | Via Nous provider |

## Knowledge Base

| Source | Path | Status |
|--------|------|--------|
| Wiki (global) | `C:/Users/Danie/knowledge/` | Exists, has project docs |
| Project wiki | `C:/Users/Danie/knowledge/projects/civs.md` | Exists, outdated |
| `AGENTS.md` | Repo root | Current, comprehensive |
| `DECISIONS.md` | Repo root | Current, 376 lines |
| `docs/ARCHITECTURE.md` | Repo | Current |
| `docs/AGENT-WORKFLOW.md` | Repo | Current, mandatory |
| `docs/CURRENT_STATE.md` | **MISSING** | **THIS FILE** |
| `docs/SOLVED_BUGS.md` | **MISSING** | **NEEDED** |
| `docs/KNOWN_BUGS.md` | **MISSING** | **NEEDED** |

## Identified Problems (from user report)

1. **Free model regression** — `nvidia/nemotron-3-ultra-550b-a55b:free` reintroduced solved bugs
2. **Knowledge base not read** — Hermes ignores `WIKI_PATH`, project docs, `AGENTS.md`
3. **Memory pollution** — Stale memory overrides codebase truth
4. **No auxiliary models** — Compression, vision, web extraction all use main model
5. **Delegation broken** — Points to local LiteLLM with mostly unhealthy endpoints
6. **No guardrails** — Agent can edit without understanding current state
7. **Single "brain" architecture** — No Architect/Coder/Reviewer/Tester separation
8. **No budget control** — €15 burned on free tier weekend

## Recovery Checkpoint

- [x] Git status captured
- [x] Last healthy commit identified (`ac306a02`)
- [x] Recovery branch created: `recovery/pre-hermes-audit-20260817`
- [x] Uncommitted changes stashed
- [x] Hermes config audited
- [x] LiteLLM health checked
- [x] Knowledge base locations mapped
- [ ] Maven build verified on target platform
- [ ] Test suite baseline established
- [ ] CURRENT_STATE.md created (this file)
- [ ] SOLVED_BUGS.md created
- [ ] KNOWN_BUGS.md created
- [ ] Neo protocol documented
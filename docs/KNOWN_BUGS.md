# Known Bugs — Civs + Agent Platform

Active bugs and regressions that need fixing. Updated as discovered.

Labels: **FACT** (verified) · **OBSERVED** (seen) · **INFERRED** · **BLOCKED** (external dependency)

---

## Critical (P0)

| ID | Bug | Impact | Status | Label |
|----|-----|--------|--------|-------|
| KB-001 | Free model reintroduces solved bugs | Regression of SB-013, SB-014, SB-015 | **Recovery in progress** — switched to PAYG | FACT |
| KB-002 | Hermes ignores knowledge base | Agent works from stale memory, not codebase | **Recovery: CURRENT_STATE.md created** | FACT |
| KB-003 | No guardrails on code edits | Agent edits without understanding state | **Pending: FASE 6** | TODO |
| KB-004 | Delegation points to unhealthy LiteLLM | Subagents fail or use wrong models | **Pending: FASE 4 routing** | FACT |

---

## High (P1)

| ID | Bug | Impact | Status | Label |
|----|-----|--------|--------|-------|
| KB-010 | LiteLLM: Groq `llama-3.3-70b-versatile` 404 | Model doesn't exist | Remove/replace in config | FACT |
| KB-011 | LiteLLM: DeepSeek invalid API key (401) | Authentication fails | Update key or remove | FACT |
| KB-012 | LiteLLM: OpenRouter key limit exceeded (403) | Budget exhausted on free key | Switch to PAYG key | FACT |
| KB-013 | No auxiliary models configured | Compression/vision/web use main model (cost/quality) | **Pending: FASE 4** | TODO |
| KB-014 | MOA references Nous free models | Uses free tier, not PAYG | Disable or reconfigure | FACT |
| KB-015 | WSL QA testserver stopped since 2026-07-17 | No live verification possible | Restart when needed | OBSERVED |
| KB-016 | Maven not on Windows PATH | Cannot build/test locally on Windows | Use WSL or cloud VM | FACT |

---

## Medium (P2)

| ID | Bug | Impact | Status | Label |
|----|-----|--------|--------|-------|
| KB-020 | `docs/CURRENT_STATE.md` was missing | No single source of truth for project state | **Fixed** — created 2026-08-17 | FACT |
| KB-021 | `docs/SOLVED_BUGS.md` was missing | No anti-regression reference | **Fixed** — created 2026-08-17 | FACT |
| KB-022 | `docs/KNOWN_BUGS.md` was missing | No active bug tracker in repo | **This file** | FACT |
| KB-023 | Neo protocol not documented | No guardrails for agent behavior | **Pending: FASE 3** | TODO |
| KB-024 | Knowledge base wiki not synced | `C:/Users/Danie/knowledge/projects/civs.md` outdated | Sync after recovery | INFERRED |
| KB-025 | Companion repo `civs-quests` doc fixes blocked | No push access to Daniel730/civs-quests | Patch saved, needs owner | BLOCKED |

---

## Low (P3)

| ID | Bug | Impact | Status | Label |
|----|-----|--------|--------|-------|
| KB-030 | Flaky `RegionsTests.dailyRegionShouldUpkeepDaily` | Full suite flakes, passes in isolation | Documented in AGENTS.md | FACT |
| KB-031 | `nocheatplus` jitpack 404 workaround needed | Manual install if ~/.m2 wiped | Documented in AGENTS.md | FACT |
| KB-032 | Mineflayer unusable on Paper 26.1.2 | Already decided: use harness capabilities | D-AP-001 | DECISION |
| KB-033 | No JVM OpenTelemetry instrumentation | Only Node runner has OTel | Issue #32 / D-AP-014 | TODO |

---

## Hermes-Specific Bugs

| ID | Bug | Impact | Status | Label |
|----|-----|--------|--------|-------|
| KB-H01 | Main model = free tier (`nemotron-3-ultra:free`) | Caused €15 burn + regressions | **FIXED** — switched to LiteLLM local `mistral/mistral-small-latest` | FACT |
| KB-H02 | Delegation `provider: custom`, `base_url: http://127.0.0.1:4000/v1` | Points to broken LiteLLM | **FIXED** — `provider: openrouter`, `model: poolside/laguna-s-2.1:free` | FACT |
| KB-H03 | Auxiliary models all empty (`vision.model: ''`) | Falls back to main model | **FIXED** — `nvidia/nemotron-3-super-120b-a12b:free` | FACT |
| KB-H04 | MOA enabled with free Nous models | Unreliable, not PAYG | **FIXED** — disabled | FACT |
| KB-H05 | Memory char limit 2200, user 1375 | May truncate important context | Review after recovery | INFERRED |
| KB-H06 | No A2A agent separation | Single "Neo" does everything | **PENDING** — FASE 5 | TODO |
| KB-H07 | Filesystem MCP server points to `C:/Users/Danie/Downloads/Civs-1.11.6` | Correct path but no git repo at root | Verify scope | INFERRED |
| KB-H08 | `minecraft-qa` MCP uses WSL paths from bot-server | `/home/dansilva/...` not this Windows host | Works via WSL, verified | FACT |

---

## Triage Rules

1. **P0** — Blocks all work, fix immediately
2. **P1** — Blocks reliable operation, fix before new features
3. **P2** — Degrades quality, fix in next iteration
4. **P3** — Known limitation, document and defer

**Update this file** when:
- Bug fixed → move to SOLVED_BUGS.md
- New bug discovered → add here with ID
- Priority changes → update table
- Verification completed → update Status column
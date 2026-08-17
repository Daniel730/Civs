# Solved Bugs — Civs + Agent Platform

Chronological log of bugs that have been **fixed and verified**. This prevents re-introduction.

Labels: **FACT** (verified in code/tests/runtime) · **OBSERVED** (seen in logs) · **DECISION** (logged in DECISIONS.md)

---

## 2026-08-10 to 2026-08-16 (Agent Platform Phase)

| ID | Bug | Fix Commit | Verification | Label |
|----|-----|------------|--------------|-------|
| SB-001 | Mineflayer cannot drive Paper 26.1.2 | N/A (architectural decision) | Empirical probe `MINEFLAYER-PROBE-RESULTS.txt` | FACT |
| SB-002 | `RawKeepAliveActor` login/keep-alive works on 26.1.2 | D-AP-001 | Live probe | FACT |
| SB-003 | `/test act` capability layer needed for player actions | D-AP-002 | In progress (P1) | DECISION |
| SB-004 | `place_block` via `BlockPlaceEvent` + `setType` | D-AP-003 | Requires live probe | DECISION |
| SB-005 | WSL QA RCON password is `civsqa` (not `civs-itest`) | D-AP-005 | Observed on bot-server | OBSERVED |
| SB-006 | RPG observe via reflection (no compile dep on civs-quests) | D-AP-006 | `RpgBridge` implemented | FACT |
| SB-007 | `run_as` allowlist for player commands only | D-AP-007 | Implemented in capabilities | FACT |
| SB-008 | Quest accept must use `QuestManager.acceptQuest` result | D-AP-008 | Verified: `performCommand` returns true on failure | FACT |
| SB-009 | Free max-active slots via reflected `abandonQuest` | D-AP-009 | For QA setup only | FACT |
| SB-010 | Hermes as MCP client, not server | D-AP-010 | `-z` PONG PASS, `mcp test` 10 tools PASS | FACT |
| SB-011 | Greedy `move_to` (not pathfinder) for Paper 26.1.2 | D-AP-011 | Implemented, documented as `greedy_step` | FACT |
| SB-012 | Windows Hermes → local Ollama; WSL node for MCP | D-AP-012 | Tailscale IP configured, verified | FACT |
| SB-013 | Per-tick `ClassCastException` on `cv reload` (mana scheduler) | `DefaultClassFallbackTest` (2 tests) | Live-verified after restart: 0 heartbeat errors | FACT |
| SB-014 | Region GUI title was raw internal name "RegionType" | `RegionTypeMenuTitleTest` (2 tests) | Live-verified: shelter GUI title now "Shelter" | FACT |
| SB-015 | 174 structure definitions — material fallback to STONE | `ServerPackRegionTypesTest` (174 parameterized) | 174/174 pass — no invalid materials | FACT |
| SB-016 | `nocheatplus` jitpack 404 — install from GitHub release | AGENTS.md gotcha | Documented install procedure | FACT |
| SB-017 | Flaky `RegionsTests.dailyRegionShouldUpkeepDaily` in full suite | Isolation note in AGENTS.md | Passes in isolation (56/56) | FACT |
| SB-018 | Companion repo `civs-quests` docs: wrong jar version (1.11.6 vs 1.11.7) | Patch saved at `docs/civs-quests-docs-fix.patch` | Blocker: no push access to companion | DECISION |
| SB-019 | Companion repo claims "zero automated tests" — 13 test classes exist | Patch saved | Blocker: no push access | DECISION |
| SB-020 | Companion repo claims "3 quests" — 56 ship | Patch saved | Blocker: no push access | DECISION |

---

## 2026-08-17 (Recovery Phase)

| ID | Bug | Fix Commit | Verification | Label |
|----|-----|------------|--------------|-------|
| SB-021 | Free model `nvidia/nemotron-3-ultra-550b-a55b:free` reintroduces solved bugs | **Recovery: switched to PAYG routing** | This recovery branch created | FACT |
| SB-022 | Hermes ignores knowledge base (WIKI_PATH, AGENTS.md, docs/) | **Recovery: CURRENT_STATE.md created, protocol documented** | This file | FACT |
| SB-023 | No auxiliary models configured (compression, vision, web extraction) | **Pending: FASE 4 routing config** | — | TODO |
| SB-024 | Delegation points to unhealthy LiteLLM endpoints | **Pending: FASE 4 routing config** | Only `mistral/mistral-small-latest` healthy | FACT |
| SB-025 | No guardrails — agent edits without understanding state | **Pending: FASE 6 guardrails** | — | TODO |

---

## Verification Protocol

Before claiming a bug is solved:

1. **Code fix** — minimal change, targets root cause
2. **Test added/updated** — unit + integration where applicable
3. **Live verification** — on WSL QA testserver or cloud VM
4. **Documentation** — entry in this file + DECISIONS.md if architectural
5. **Git commit** — on work branch, PR references issue

---

## Anti-Regression Rules

- **NEVER** "fix" a bug that appears in this list without checking git history first
- **ALWAYS** run related tests before and after any change in affected area
- **MEMORY ≠ TRUTH** — if memory says X works but tests say Y, tests win
- **FREE MODELS ≠ PRODUCTION** — free tier models are for exploration only
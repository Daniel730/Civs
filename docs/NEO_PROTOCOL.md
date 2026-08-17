# Neo Protocol — Agent Operating Rules

**Mandatory process for all agents working on Civs + Agent Platform.**
This is not a suggestion. Violations = rolled-back changes.

---

## Core Principle

> **Knowledge retrieval → Evidence → Action**
>
> Not: *Memory → Confidence → Action*

An agent that cannot demonstrate understanding of current state **must not edit code**.

---

## Pre-Edit Checklist (ALL REQUIRED)

Before ANY file modification, the agent must verify and log:

- [ ] **Identified affected files** — exact paths
- [ ] **Found current implementation** — read the actual code
- [ ] **Found existing tests** — unit + integration for the area
- [ ] **Searched related bugs/decisions** — `DECISIONS.md`, `SOLVED_BUGS.md`, `KNOWN_BUGS.md`
- [ ] **Checked git history** — `git log -p -S <keyword>` for context
- [ ] **Can explain current behavior** — in plain language, from code
- [ ] **Has minimal change plan** — smallest diff that solves the problem

**If ANY check fails: STOP. Do not improvise.**

---

## Workflow: Issue → PR → Verified Commit

```
Issue (GitHub, typed label)
    ↓
Architect: investigate + propose (NO code)
    ↓
Coder: implement minimal change + tests
    ↓
Reviewer: "Does this break anything that worked?"
    ↓
Tester: mvn test + runner scenarios + evidence
    ↓
Diff inspection (human or reviewer agent)
    ↓
Commit (only after all above pass)
```

**Never**: "Neo, go fix the whole project."

---

## Agent Roles (A2A Separation) — IMPLEMENTED 2026-08-17

| Role | Skill | Can | Cannot | Model (free) |
|------|-------|-----|--------|--------------|
| **Architect** | `civs-a2a-architect` | Analyze, research, propose, document | Write implementation code | `z-ai/glm-5.2:free` / `mistral-small-latest` |
| **Coder** | `civs-a2a-coder` | Edit files, create tests, implement | Decide architecture, skip tests | `mistral-small-latest` (local) |
| **Reviewer** | `civs-a2a-reviewer` | Read diffs, run static analysis, question | Implement, approve own code | `poolside/laguna-s-2.1:free` |
| **Tester** | `civs-a2a-tester` | Run tests, lint, build, smoke, report | Edit code, decide pass/fail | `mistral-small-latest` (local) |
| **Neo (Orchestrator)** | `civs-neo-orchestrator` | Delegate, sequence, enforce gates | Write code, skip steps | N/A |

Each role is a separate A2A agent with its own context and model.
Skills created at `~/AppData/Local/hermes/skills/software-development/civs-a2a-*`.

## How to invoke (Neo protocol)
```
User request
  → Neo loads civs-neo-orchestrator
  → Neo delegates to Architect (civs-a2a-architect)
  → Architect returns analysis
  → Neo delegates to Coder (civs-a2a-coder)
  → Coder returns implementation + tests
  → Neo delegates to Tester (civs-a2a-tester)
  → Tester returns evidence
  → Neo delegates to Reviewer (civs-a2a-reviewer)
  → Reviewer returns APPROVE / REQUEST_CHANGES
  → If APPROVE: Neo commits (or asks user)
  → If REQUEST_CHANGES: loop back to Coder
```

---

## Model Routing (OpenRouter PAYG — €20/mês)

| Tier | Budget | Use For | Example Models |
|------|--------|---------|----------------|
| **Auxiliary** (€5) | Compression, vision, web extraction, approval, session search, title gen | `google/gemini-3.5-flash-lite`, `qwen/qwen3.7-flash` |
| **Normal** (€10) | Coder, Tester, normal coding tasks | `deepseek/deepseek-v4-flash-0731`, `poolside/laguna-s-2.1` |
| **Strong** (€5) | Architect, debugging, reasoning, complex analysis | `anthropic/claude-opus-5`, `google/gemini-3.7-flash` |
| **Safety** (€5 reserve) | Emergency, difficult tasks | — |

**Hard ceiling: €20/mês.** No automatic spend. Alert at €15.

---

## Guardrails (Enforced by Neo)

### 1. No Destructive Git Operations
- `git reset --hard`, `git clean -fd`, `git push --force` — **FORBIDDEN**
- Merge/rebase only via PR workflow

### 2. Test-First
- No implementation without failing test first (TDD)
- `mvn -B test` must pass before commit
- Runner scenarios for integration changes

### 3. Evidence-Based Claims
- "It works" → show test output / log / screenshot
- "Bug fixed" → show before/after test + git diff
- "Performance improved" → show benchmarks

### 4. Memory ≠ Truth
- If `MEMORY.md` says X but `tests/` says Y → **tests win**
- If `AGENTS.md` says X but `src/` says Y → **src wins**
- Agent must re-read codebase, not rely on memory

### 5. Budget Awareness
- Log model used + estimated cost per task
- Stop at €15/mês, alert user
- Free models ONLY for exploration, never production edits

### 6. Delegation Safety
- Subagents inherit parent model unless explicitly pinned
- `provider: custom`, `base_url: http://127.0.0.1:4000/v1`, `max_tokens ≤ 2048`
- Subagent transcripts saved to `AppData/Local/hermes/cache/delegation/live/<id>/task-N.log`
- **Verify subagent claims** — fetch URL, stat file, read content

---

## Knowledge Base Hierarchy (Source of Truth)

```
1. SOURCE CODE          (src/, integration-tests/, tests/)        — WINS ALWAYS
2. TESTS                (JUnit, runner scenarios, Playwright)     — WINS OVER MEMORY
3. GIT HISTORY          (git log, git blame, DECISIONS.md)        — CONTEXT
4. PROJECT DOCS         (AGENTS.md, ARCHITECTURE.md, CURRENT_STATE.md) — REFERENCE
5. WIKI                 (C:/Users/Danie/knowledge/)               — CROSS-PROJECT
6. HERMES MEMORY        (~/.hermes/memories/, SOUL.md)            — USER PREFS ONLY
7. AGENT MEMORY         (in-context, compressed)                  — EPHEMERAL
```

**Rule**: Lower number beats higher number. Always.

---

## Required Artifacts Per Change

| Artifact | When | Location |
|----------|------|----------|
| GitHub Issue | Every non-trivial change | `github.com/Daniel730/Civs/issues` |
| PR Description | Every commit | `Closes #N` + test plan |
| Test Evidence | Every PR | CI logs + local `mvn test` output |
| Decision Log | Architectural choices | `DECISIONS.md` (append) |
| Bug Resolution | Bug fixed | `SOLVED_BUGS.md` (append) |
| New Bug | Bug discovered | `KNOWN_BUGS.md` (append) |
| State Update | Milestone reached | `CURRENT_STATE.md` (update) |

---

## Anti-Patterns (What Got Us Here)

| Anti-Pattern | Consequence | Correction |
|--------------|-------------|------------|
| "Neo, fix everything" | Regressions, hallucinated fixes | Issue → Architect → Coder → Review → Test |
| Free model for production | €15 burned, bugs reintroduced | PAYG routing, tiered models |
| Trusting memory over code | Solved bugs reappear | Read codebase every time |
| Single agent does all | No checks, no balance | A2A role separation |
| No auxiliary models | Main model wasted on compression | Cheap models for aux tasks |
| No budget limit | Surprise costs | Hard €20/mês ceiling |

---

## Emergency Stop Conditions

If any of these occur, **Neo halts all agents immediately**:

1. Test suite regression (previously passing tests fail)
2. Budget > €15/mês
3. Agent claims "done" without evidence
4. Destructive git operation attempted
5. Subagent hallucinates file/URL/test result
6. Knowledge base contradiction unresolved

**User must explicitly resume.**

---

## Quick Reference: Neo Commands

```bash
# Recovery
git status
git log --oneline -10
git checkout -b recovery/<name>
git stash

# Verify
mvn -B -DskipTests compile
mvn -B test -Dtest=<SpecificTest>
cd integration-tests/runner && npm run lint && npm run test:unit

# Knowledge
cat docs/CURRENT_STATE.md
cat docs/SOLVED_BUGS.md
cat docs/KNOWN_BUGS.md
cat DECISIONS.md | tail -50

# Hermes Config
cat ~/.hermes/config.yaml
hermes config get model.default
hermes config get delegation.base_url
```

---

## Sign-Off

This protocol is **active and enforced** as of 2026-08-17.

Any agent (human or AI) working on this repo follows these rules.
No exceptions. No "just this once."

**The system is code. The rules are the protocol. Follow them.**
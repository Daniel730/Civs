# Night shift report — 2026-08-11

Unattended night shift on `Daniel730/Civs`. Labels: **FACT** · **OBSERVED** · **INFERRED**.

## NIGHT SHIFT SUMMARY

### Completed
- **Verified #32 / PR #46** (OTel): mergeable, CLEAN; local unit 10/10; `test:otel-validate` + `--mcp` PASS (scenario→step→move_to→rcon). No rewrite. **FACT**
- **#35 Biome + commitlint + knip**: implemented, tested, PR opened. **FACT**
- **#42 CI gates**: Maven + runner-quality workflows, master branch protection, docs. **FACT**
- **#41 RegionsTests fixture** + CI-order isolation for Items/Civilian tests (needed to unblock `maven-test`). **FACT**

### PRs
| PR | Title | Base | Status (at report time) |
|----|-------|------|-------------------------|
| [#46](https://github.com/Daniel730/Civs/pull/46) | OTel primary instrumentation (#32) | `cursor/agent-platform-p1` | OPEN, MERGEABLE; no required checks on that base **OBSERVED** |
| [#47](https://github.com/Daniel730/Civs/pull/47) | Biome + commitlint + knip (#35) | `feat/otel-integration-runner` | OPEN; Biome + commitlint **PASS** **FACT** |
| [#48](https://github.com/Daniel730/Civs/pull/48) | Maven CI + merge gates (#42) + test isolation (#41) | `feat/biome-runner-quality` | OPEN; runner-quality PASS; `maven-test` re-running after isolation fix **OBSERVED** |
| [#45](https://github.com/Daniel730/Civs/pull/45) | Workflow docs (#31) | `master` | OPEN (pre-existing; not modified this shift) **OBSERVED** |

Stack for merge: `#46` → `#47` → `#48` (or squash-merge in that order onto `cursor/agent-platform-p1` / agreed trunk).

### Issues
| Issue | Outcome |
|-------|---------|
| #32 | Done in PR #46; left open until merge **FACT** |
| #35 | Closes via PR #47 **FACT** |
| #42 | Closes via PR #48 **FACT** |
| #41 | Closes via PR #48 (fixture + docs) **FACT** |
| #33–#34, #36–#40, #43–#44 | Not started this shift |

### Tests
- Runner: `npm run lint` clean (24 files); `npm run knip` clean; `npm run test:unit` 10/10; OTel validate + MCP tree PASS **FACT**
- Java local: `mvn -B -DskipTests compile` SUCCESS; `mvn -B test` **764** tests, **0** failures, 6 skipped (after isolation fixes) **FACT**
- First GHA `maven-test` on #48: **4 failures** (ItemsTests×2, CivilianTests×2) under Linux order — not RegionsTests **FACT**
- Second GHA `maven-test`: in progress / re-check after push of isolation commit **OBSERVED**

### Empirical validations
1. OTel memory exporter tree: `scenario.run → scenario.step → minecraft.move_to → rcon.send` (+ `mcp.tool` parent) **FACT**
2. Commitlint: conventional title accepted; non-conventional rejected **FACT**
3. GHA `runner-quality` on #47: Biome + knip + Conventional PR title **PASS** **FACT**
4. `master` branch protection required contexts set via API: `maven-test`, `Biome + knip`, `Conventional PR title` **FACT**
5. nocheatplus CI install-from-release step completed successfully on GHA **FACT**

### Blocked
None hard-blocked for remaining high-priority unlockers. Soft notes:

| Item | Cause | Attempted | Evidence | Why not finished | Min action |
|------|-------|-----------|----------|------------------|------------|
| Live Paper / Hermes E2E | Not in night-shift scope; no testserver this run | Skipped per mission | N/A | Out of priority | Optional later |
| #38 Codecov | Needs `CODECOV_TOKEN` secret | Not started | Issue acceptance | Secret not verified in env | Add secret then wire JaCoCo/c8 upload |
| #33 Sentry | After OTel; needs DSN secret | Deferred | Mission: do not expand OTel | Wait #32 merge | Bridge after #46 |
| First `maven-test` red | Order-dependent fixtures | Fixed in `f6c4a801` | GHA log: GRAVEL vs COBBLESTONE; isAtMax cobble | Await re-run green | Confirm #48 `maven-test` PASS |

### Next recommended issue
1. Confirm **PR #48 `maven-test` green**, then merge stack **#46 → #47 → #48** (or rebase as preferred).
2. **#36 arch-contract** (dependency-cruiser on runner) — unlocks import boundaries on top of Biome/knip.
3. **#38 Codecov** once token available.
4. Avoid AI world / Director / OBS / 24-7.

### Repository state
- Current branch (workspace): `feat/ci-gates-42` @ `f6c4a801` tracking `origin/feat/ci-gates-42` **FACT**
- Untracked local QA scripts under `scripts/_*.sh` / `scripts/qa/` **not committed** (left alone) **FACT**
- Decisions added: **D-AP-015** (Biome/knip/commitlint), **D-AP-016** (CI gates / protection) **FACT**
- Docs updated: `docs/AGENT-WORKFLOW.md` §3, `docs/TESTING.md` CI gates + flake notes, `docs/NIGHT-SHIFT-REPORT.md` (this file)

### Assumptions (not claimed as fact)
- Merging the stacked PRs in order will close #32/#35/#41/#42 without further conflicts (**INFERRED**).
- Branch protection on `master` alone is sufficient for the current deploy path; platform feature branches are not protected (**OBSERVED** protection only on `master`).

# SUMMARY — Autonomous run

Consolidated summary of the autonomous run. Full decision-by-decision rationale is in
[`DECISIONS.md`](DECISIONS.md).

- **Main repo:** `Daniel730/Civs` (Bukkit/Paper plugin, Java 25 / Paper 26.1.2), work
  branch `cursor/autonomous-run-c158`.
- **Companion RPG:** `Daniel730/civs-quests` (RPGServer plugin).

## What was done, by stage

### Stage 1 — Repository sync
- Pulled latest `master` (`8b051eca`); cloned `civs-quests` (`35215e7b`).
- Both are single-module Maven builds. Installed/verified all dependencies from the
  snapshot `~/.m2` (incl. the awkward JitPack `nocheatplus` dep).
- Built **both**: `civs-1.11.7.jar` and `rpg-server-0.1.2.jar`. Fixed the companion's
  side-by-side build by symlinking `Civs-1.11.6 -> /workspace` (its pom needs that path).

### Stage 2 — Test environment + "dumb player"
- Stood up a full Paper 26.1.2 server: **Civs + RPGServer + Vault + a minimal QA economy
  provider** (Civs "Hooked into Economy"; RPGServer "Civs detectado", 56 quests loaded).
- **Dumb player:** the real official `26.1.2` client (Mineflayer's protocol is too old for
  this version), driven via computer-use. **World-interaction helper:** Civs' built-in
  `/cv give` and `/cv placeregion` admin commands (already in-repo, integrate with the
  region model — better than a generic teleport/spawn plugin).
- Proven end-to-end: the player logs in, moves, and interacts with a structure — placed a
  `shelter` and opened its GUI (video + log artifacts).

### Stage 3 — Structures ("Civs")
- Enumerated **174** structures (region types) across 12 categories → `docs/STRUCTURE-TEST-REPORT.md`.
- Added `ServerPackRegionTypesTest`: a **data-driven test with one passing case per
  structure** that loads each real definition and fails if any material is invalid on
  Paper 26.1.2 (Civs silently falls back to STONE otherwise). **Result: 174/174 pass.**
- Runtime placement additionally smoke-tested for `shelter` via the dumb player.

### Stage 4 — Interface & usability
- Listed usability problems by impact from driving the GUI with the dumb player.
- **Fix #1 (highest impact):** the region GUI title was the raw internal name
  `RegionType`; now it shows the structure's name (e.g. **"Shelter"**). Overridable
  `CustomMenu.getMenuTitle` (all other menus unchanged). Verified live (video).
- **Bug found + fixed:** a per-tick `ClassCastException` in the mana scheduler when
  `default-class` resolved to a non-class item after a reload — `createDefaultClass` now
  falls back to a real class type instead of crashing ~20×/sec. Verified live (0 errors).

### Stage 5 — Documentation
- Rewrote the Civs `README.md`: removed redundant NoCheatPlus variants, fixed the
  folder-name/version confusion, and **added the missing "how to run on a Paper server"
  and "code structure" sections** + a companion-repo section.
- **Simulated a fresh setup** following only the new docs (removed the dep, confirmed the
  documented failure, applied the documented fix, built successfully).

## Tested and passing
| Check | Command / method | Result |
| --- | --- | --- |
| Civs build | `mvn clean package -DskipTests` | `civs-1.11.7.jar` |
| Companion build | `mvn -DskipTests package` (side-by-side) | `rpg-server-0.1.2.jar` |
| Full unit suite | `mvn test` | **605 tests, 0 failures, 6 skipped** |
| All 174 structures | `ServerPackRegionTypesTest` | 174/174 pass |
| Run end-to-end | Paper 26.1.2 + both plugins + economy | boots, plugins enabled |
| Dumb player | real client via computer-use | login + move + place/open a structure |
| UI title fix | live, in-client | title shows "Shelter" (was "RegionType") |
| Crash fix | live, after restart | 0 mana-scheduler errors |
| Docs | fresh-setup simulation | build reproduced from scratch |

## Pending / blocked
- **Companion-repo doc fixes are blocked on access.** `civs-quests` docs had a
  build-breaking stale reference (`civs-1.11.6.jar` vs the pom's `civs-1.11.7.jar`) plus
  false "zero tests"/"3 quests" claims. Fixes are committed on a local branch but
  **`git push` to `Daniel730/civs-quests` returns 403** (the bot only has write access to
  `Daniel730/Civs`). Ready-to-apply patch: [`docs/civs-quests-docs-fix.patch`](docs/civs-quests-docs-fix.patch).
  *Action needed:* apply the patch, or grant the bot push access to that repo.
- **Structures** are covered by definition-load tests for all 174 + a runtime smoke for
  one; exhaustively placing every structure in-world (each needs its blueprint footprint
  built) was out of scope for this pass — the load-validation is the durable regression net.

## Key autonomous decisions (see DECISIONS.md for the rest)
- Real client instead of Mineflayer (protocol too new); Civs admin commands instead of a
  third-party world-interaction plugin; a tiny QA economy provider instead of EssentialsX
  (won't load on this MC version); data-driven per-structure test instead of 174 bespoke
  tests; defensive class-resolution fix regardless of the config-specific root cause.

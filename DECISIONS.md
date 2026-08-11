# DECISIONS.md — Autonomous run log

Chronological log of every non-trivial decision (technical or product), the reason
for it, and any assumption made instead of asking a question. This file is for
later review, not real-time approval. Newest entries at the bottom of each stage.

Mode: full autonomy. Only genuinely unresolvable blockers (missing credentials,
API keys, external services down) are escalated; everything else is decided from
code, platform docs, or best practices and logged here.

Project facts (filled in from the repos, since the prompt left them as placeholders):

| Field | Value |
| --- | --- |
| Main repo | `github.com/Daniel730/Civs` (Bukkit/Paper plugin) |
| Working branch (main repo) | `master` → work branch `cursor/autonomous-run-c158` |
| Complementary RPG repo | `github.com/Daniel730/civs-quests` (RPGServer plugin), branch `master` |
| Platform / engine | Minecraft — Paper 26.1.2 server, Bukkit/Paper API |
| Language | Java 25 (Maven) |

---

## Stage 1 — Repository sync

**S1.1 — Main repo state recorded before work.**
`git log -1` on `Daniel730/Civs`:
- commit `8b051ecac2091d278e91dedfab01f0f430a6850d`
- `2026-08-04 10:47:20 +0100` — "Merge pull request #27 from Daniel730/cursor/update-dev-environment-c158"
This already includes the dev-environment doc fixes merged earlier this session.

**S1.2 — Complementary RPG repo cloned.**
`Daniel730/civs-quests` cloned to `/home/ubuntu/civs-quests`. `git log -1`:
- commit `35215e7b97eacddf0d742a38f47abb073c2d2214`
- `2026-07-19 02:25:40 +0100` — "docs: simplify NoCheatPlus installation for pure Windows CMD..."
- branch `master`.
Decision: cloned outside `/workspace` (into `$HOME`) so it is not nested inside the
Civs git tree and so it persists in the VM snapshot (home dir persists; `/workspace`
is re-cloned each run). The prompt's `[URL do repo do RPG]` placeholder was resolved
by listing the owner's GitHub repos and matching the "complementary RPG of Civs" —
`civs-quests` is the only quest/RPG companion.

**S1.3 — Dependencies.**
Both projects are single-module Maven builds (no npm/pip). Dependency sources:
- Civs `pom.xml`: Paper-api `26.1.2.build.72-stable`, WorldEdit, Vault, bStats,
  Pl3xmap, and the awkward `nocheatplus` jitpack dep (see AGENTS.md gotcha).
- civs-quests `pom.xml`: Paper-api, VaultAPI, PlaceholderAPI, AuraSkills API,
  LuckPerms API, log4j, JUnit/Mockito, and a **`system`-scoped dependency on the
  Civs jar** at `${project.basedir}/../Civs-1.11.6/target/civs-1.11.7.jar`.
- Install: `mvn -B -DskipTests dependency:resolve` for Civs resolves fully from the
  snapshot `~/.m2` (all deps cached, incl. the nocheatplus fixup). No install errors.

**S1.4 — Build both projects.**
- Civs: `mvn -B -DskipTests package` → `target/civs-1.11.7.jar` (2.4 MB). BUILD SUCCESS.
  `mvn -B test` → 427 run, 0 failures, 6 skipped.
- civs-quests: builds against the Civs jar. **Problem:** its pom hard-codes the Civs
  jar at a *sibling* path named `Civs-1.11.6`, but this checkout is at `/workspace`.
  **Fix (decision):** created symlink `/home/ubuntu/Civs-1.11.6 -> /workspace` so the
  `system` path resolves without editing the companion pom (keeps the companion repo
  untouched and matches the layout its README documents). `mvn -B -DskipTests package`
  → `target/rpg-server-0.1.2.jar`. BUILD SUCCESS (91 main + 13 test sources).
  Note: companion README claims "zero automated tests", but 13 test sources exist —
  flagged for Stage 5 docs cleanup.

---

## Stage 2 — Test environment with a "dumb player"

**S2.1 — Server stack.**
Stood up a local Paper 26.1.2 (build 72) server at `/workspace/testserver` (git-ignored)
with: `Civs.jar`, `RPGServer.jar` (companion), `Vault.jar`, and a minimal economy
provider. Full config pack `Civs_servidor/` copied into `plugins/Civs/`.
Boot log confirms: Civs "Hooked into Economy plugin: QAEcon", RPGServer "Vault Economy
conectada" + "Civs detectado" (56 quests, 37 perks, 27 POIs loaded).

**S2.2 — Economy provider (decision: build a tiny one).**
Civs money flows (shop/town/region buy, taxes) need a Vault `Economy` provider, and
RPGServer's Vault hook is inert without one. Real economy plugins (EssentialsX) are
built for released MC versions and are unlikely to load on the fictional-future
Paper 26.1.2 in this environment. **Decision:** wrote a ~4 KB `QAEcon` plugin (a
`JavaPlugin` that registers a `QAEconomy implements net.milkbowl.vault.economy.Economy`
giving every player a 1,000,000 starting balance). Kept in `/home/ubuntu/econprovider`
(QA-only, not committed to either product repo). Had to split the provider out of the
`JavaPlugin` subclass because Bukkit makes `getName()`/`isEnabled()` final (they clash
with the Vault `Economy` interface).

**S2.3 — "Dumb player": chose the real official client over a library bot.**
Evaluated the community-standard headless bot **Mineflayer** (Node). It is actively
maintained and the usual choice, BUT its protocol layer (`minecraft-protocol` 1.66.2 /
`minecraft-data` 3.112.0) only supports up to real MC ~1.21; it cannot speak this
server's `26.1.2` protocol. **Decision:** use the real official Minecraft client
`26.1.2` (present in the Mojang manifest) launched in offline mode and driven via
computer-use — the approach already documented in `AGENTS.md`. It is heavier but is
the only client that speaks the protocol, and it is also required for the visual
usability work in Stage 4. Wrote `/home/ubuntu/mcclient/setup.js` to provision it
(client jar + Linux libraries incl. lwjgl `natives-linux` + full asset index/objects;
61 libs, 4750 asset objects) and emit a `launch.sh` (software GL via
`LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe`).

**S2.4 — World-interaction helper: use Civs' built-in admin QA commands.**
The prompt asks to install a plugin that makes interacting with the world easier
(give items, place structures). The Civs repo *already ships* purpose-built admin QA
commands (added in commit `9e1d4dea`): `/cv give <player> <itemType> [qty]` and
`/cv placeregion <player> <regionType> [x y z]` (OP / `civs.admin`, console-usable).
**Decision:** use these instead of adding a third-party plugin — they are maintained
in-repo, integrate directly with Civs' item/region model (a generic teleport/spawn
plugin cannot create Civs regions), and let a console operator drive the dumb player
without mouse control. If broader world manipulation is later needed, WorldEdit/FAWE
(already a Civs dependency) is the maintained community choice.

**S2.5 — Confirmed dumb player can log in, move, and interact with a structure.**
The real client joined the server as `Tester` (RPGServer boss-bar + Civs tutorial HUD
visible), was moved via WASD, and a `shelter` structure was placed at its feet via
`/cv give Tester shelter` + `/cv placeregion Tester shelter` (server log: "Region
shelter created ... placeregion OK shelter @ -10,-60,6"). Right-clicking the
structure's center chest opened the Civs region GUI. Example log saved as an
artifact. RegionCreatedEvent fires into RPGServer (companion loaded "Civs detectado").

---

## Stage 3 / 4 — Structures & usability (in progress)

**Reload vs restart (important environment learning).** `/cv reload` only re-reads
Civs YAML/config; it does NOT reload the plugin jar. Java code changes require a full
server restart to take effect. (Discovered when a rebuilt jar's fixes appeared not to
apply after `cv reload`.) Documented so future agents don't chase phantom failures.

**S4.1 — Usability issue list (from driving the dumb player through the region GUI).**
Prioritised by impact (what most confuses/blocks a player first):
1. **[High] Region GUI title was the raw internal name "RegionType"** — meaningless to
   players; every structure's info screen looked identical/cryptic.
2. [Med] Payout icons appear with terse numbered labels; minor.
3. [Med] Effects shown as a raw key list (e.g. `block_break`), not friendly text.
4. [Low] Lots of empty GUI slots; weak visual grouping.
Chose #1 first: highest impact, self-contained, and precisely verifiable.

**S4.2 — Fix #1: region menu title now shows the structure name.**
`CustomMenu.createMenu` used `getName()` (internal id) as the inventory title for
*every* menu. Added an overridable `getMenuTitle(civilian)` (default unchanged =
`getName()`, so all other menus keep their current titles) and overrode it in
`RegionTypeMenu` to return `regionType.getDisplayName(player)`. Verified safe: click
routing keys off `MenuManager.openMenus` (menu name), not the inventory title.
Test: `RegionTypeMenuTitleTest` (2). Live-verified: the shelter GUI title now reads
**"Shelter"** (was "RegionType") — screen recording saved.

**S3/S4 bug found + fixed — per-tick ClassCastException.**
While a player was online, `cv reload` made the mana scheduler spam a
`ClassCastException` every tick: `ClassManager.createDefaultClass` blindly cast
`getItemType(default-class)` to `ClassType`. After a reload the configured
`default-class` resolved to a non-class item, so the cast threw ~20x/sec.
**Fix:** `createDefaultClass` now resolves the class defensively and falls back to any
loaded `ClassType` (warning once) instead of crashing, so mana/spells keep working.
Test: `DefaultClassFallbackTest` (2). Live-verified after restart: 0 heartbeat errors.
The root cause of the misresolution is config-set specific; the defensive fix is
correct regardless and prevents a tick-rate crash loop.

**S3.1 — "Every structure" strategy (decision).**
There are **174** structures (region types, `type: region`) in the server pack across
12 categories. Hand-writing 174 bespoke end-to-end tests is impractical and low-value;
the real post-migration risk is a definition referencing a Material/enum that was
renamed/removed on Paper 26.1.2 (Civs silently falls back to STONE, so the structure
"loads" but is broken). **Decision:** a data-driven JUnit test
(`ServerPackRegionTypesTest`, JUnit Parameterized) produces **one passing test case per
structure** that loads the real definition and fails if any material falls back to
STONE. This satisfies "a passing, documented test for every structure" pragmatically
and durably, and doubles as a migration regression guard. Result: **174/174 pass** —
no structure references an invalid material on Paper 26.1.2. Runtime placement is
additionally smoke-tested end-to-end for `shelter` via the dumb player. Inventory of
all structures + state: `docs/STRUCTURE-TEST-REPORT.md` (generated by
`scripts/structure_report.sh`).
- **Assumption logged:** "structure works" == "definition loads with all materials
  valid on the target version + the create/placement pipeline works" (proven for a
  representative structure). Exhaustively placing all 174 in-world would require
  building each blueprint's block footprint (admin placement uses MANUAL mode); the
  load-validation + pipeline smoke is the high-value subset chosen under full autonomy.

---

## Stage 5 — Documentation

**S5.1 — Audit + classification (Civs `README.md`).**
- *Current & necessary:* overview, permissions table, command list, build prerequisites,
  the NoCheatPlus/JitPack workaround, "how to compile", the flaky-test note.
- *Redundant (removed):* four near-identical NoCheatPlus install variants (PowerShell
  heredoc, CMD-automated, etc.) — collapsed to the recommended manual `mvn install-file`
  (works on any OS) + one Linux/macOS one-liner.
- *Outdated (fixed):* the `Civs-1.11.6` folder name vs `civs-1.11.7` jar mismatch (now
  explained: folder name is irrelevant to building, jar version comes from `pom.xml`).
- *Missing (added):* **how to run the plugin** (the README only explained *building*) —
  new "Rodar em um servidor Paper" section (Paper 26.1.2 via the v3 API, Vault + an
  economy provider, deploy, `/cv`, admin QA commands, and the reload-vs-restart caveat);
  a "RPG complementar (civs-quests)" section (side-by-side build layout); and an
  "Estrutura do código" overview so a newcomer can orient without asking.

**S5.2 — Fresh-setup simulation (as required).**
Simulated a brand-new machine: deleted NoCheatPlus from `~/.m2`, then followed ONLY the
new README. The build failed exactly as the docs warn; the documented one-liner installed
the dep; `mvn clean package -DskipTests` then succeeded and produced `civs-1.11.7.jar`.
Friction found & fixed during the sim: the folder-name/jar-version confusion (clarified),
and the absent "how to run" path (added).

**S5.3 — BLOCKER (logged, not fatal): cannot push companion-repo doc fixes.**
The companion `civs-quests` docs had a **build-breaking** error (`AGENTS.md` pointed the
`system`-scoped Civs dependency at `civs-1.11.6.jar`, but `pom.xml` needs
`civs-1.11.7.jar`) plus false claims ("zero automated tests" — 13 test classes exist;
"3 quests" — 56 ship). I fixed these on a local branch `cursor/docs-fixes-c158` in
`civs-quests`, but `git push` returns **403 — the `cursor[bot]` token only has write
access to `Daniel730/Civs`, not `Daniel730/civs-quests`**. This is a genuine access
blocker (no credential I can obtain). Per the autonomy rules I did not stop: the ready-to-
apply patch is saved at `docs/civs-quests-docs-fix.patch` (and as a run artifact) for the
owner to apply, or grant the bot push access to that repo. Everything else continued.

---

## Stage AP — Autonomous Minecraft agent platform (2026-08-10)

**D-AP-001 — Extend integration-tests; do not create a competing harness.**
Recon found a working two-layer framework (`CivsTestHarness` + Node runner +
`RawKeepAliveActor`) and a separate Python `scripts/qa` path. Mission forbids destroying
working systems. **Decision:** grow agent capabilities inside `integration-tests/` and
document the platform under `docs/*`; defer a top-level `agent/` package until capabilities
are empirically stable.

**D-AP-002 — Server-side capability layer for Paper 26.1.2.**
Mineflayer remains unusable here (prior empirical probe). Raw protocol provides *presence*
only. **Decision:** add `/test act` / `/test observe` that invoke verified Paper
`Player`/`LivingEntity` APIs (`breakBlock`, `setSneaking`, `setSprinting`, `attack`,
`swingMainHand`, `setRotation`, `teleport`) against the online actor player. This is still
an *actor* concern (production event paths), not harness Civs-state creation.

**D-AP-003 — `place_block` via `BlockPlaceEvent` until a better API exists.**
Paper `Player` has `breakBlock` but no `placeBlock` (javap 26.1.2). **Decision:** implement
`place_block` by calling `BlockPlaceEvent` then `setType` if not cancelled; mark
EMPIRICALLY VALIDATED only after a live probe confirms listeners see the event. Do not
claim native client placement.

**D-AP-004 — Work branch `cursor/agent-platform-p1` from `master`.**
`docs/MIGRATION-STATUS.md` states migration landed on `master` / `v1.11.7`. **Decision:**
platform work branches from `master`, not the leftover `paper-26.1.2-migration` tip.

**D-AP-005 — WSL QA credentials differ from docs default.**
OBSERVED: `/home/dansilva/civs-testserver` uses RCON password `civsqa`. Runner docs default
to `civs-itest`. **Decision:** document both in `docs/TESTING.md` / `OPERATIONS.md`; probes
on this host must export `RCON_PASSWORD=civsqa`.

**D-AP-006 — RPG observe via reflection, not a civs-quests compile dependency.**
Harness must stay buildable from the Civs repo alone. **Decision:** `RpgBridge` reflects
`RPGServer.getProfileManager().getOrCreate(Player)` and profile getters. If RPG is absent
or the API moves, `/test rpg observe` returns `success:false` with an explicit reason.

**D-AP-007 — Allowlisted `run_as` for player commands.**
`Player.performCommand` is verified in paper-api. **Decision:** expose `act run_as` only for
prefixes `rpg|cv|say|me` so LLM/planner layers cannot escalate to arbitrary console commands
through the capability API.

**D-AP-008 — Quest accept must use QuestManager.acceptQuest result, not performCommand alone.**
EMPIRICALLY: `performCommand("rpg quest accept …")` returns true even when accept fails
(`LOCKED`, `MAX_ACTIVE`). **Decision:** `/test rpg accept` reflects
`QuestManager.acceptQuest` and reports the `QuestAcceptResult` name; scenarios assert
`SUCCESS` plus `active_quests` membership.

**D-AP-009 — Free max-active slots via reflected abandonQuest for QA setup.**
Starter merchant profiles often hold 3 active quests (`quests.max-active: 3`). **Decision:**
`/test rpg abandon` calls the real `abandonQuest` API for test setup only.

**D-AP-010 — Hermes is external explorer; harness remains sole Minecraft executor.**
Recon found Windows Hermes v0.19.0 with official `-z` oneshot, `hermes mcp add` (stdio/HTTP),
and `hermes mcp serve` (Hermes-as-server — wrong direction for our tools). **Decision:** expose
verified capabilities as an MCP **stdio Agent Gateway**; Hermes attaches as MCP **client**.
Do not invent endpoints. Mutating Hermes home config requires explicit user authorization for
that task (granted for D-AP-012).

**D-AP-011 — Greedy move_to, not pathfinder.**
Paper 26.1.2 has no Mineflayer pathfinder. **Decision:** implement `step`/`move_to` as
server-side greedy teleport stepping with standability checks. Document navigator as
`greedy_step`; mazes may `stuck`/`timeout` — that is honest failure, not fake success.

**D-AP-012 — Windows Hermes → local Ollama; WSL node for MCP (2026-08-10).**
Blockers: MoA preset `poolside/laguna-s-2.1:free` missing; no Windows `node.exe`; hostname
`desktop-vioren5-1` fails Windows DNS. User authorized Hermes home mutation for Civs QA.
**Decision:** set `model.provider: custom`, `default: hermes-agent`,
`base_url: http://100.69.136.92:11434/v1` (Tailscale IP of WSL Ollama); roles
exploratory=`hermes-agent`, summaries=`hermes-fast`, coding=`hermes-coder`
(`docs/HERMES-MODELS.md`). Register `minecraft-qa` via `hermes mcp add` with
`wsl.exe -e env … node mcp-server.js` and pipe `Y` for the enable-tools prompt. Empirically:
`-z` PONG PASS; `mcp test` 10 tools PASS. Keep Nous login as fallback only; leave MoA off.

**D-AP-013 — Platform engineering standards + Issues→PR (2026-08-11).**
User required observability (Sentry/Datadog/New Relic/OTel), JS quality
(Biome/commitlint/knip/arch-contract/Stryker), Codecov/Playwright, motion UI
(design-motion-principles), and GitHub Issues→PR for all work. **Decision:** document
mandatory process in `docs/AGENT-WORKFLOW.md` + `.cursor/rules/agent-workflow.mdc`;
**OpenTelemetry is the primary instrumentation contract** — Sentry for errors; Datadog
*or* New Relic as one APM backend via OTLP (not three parallel SDKs). Install
`kylezantos/design-motion-principles` under `.cursor/skills/`. Backlog filed as
issues #31–#44. Hermes-fast used for checklist draft; Hermes-coder backlog timed out
— parent authored issues. Full tool install is incremental via those issues, not a
big-bang rewrite of the Paper plugin.

**D-AP-014 — OpenTelemetry Node-first for #32 (2026-08-11).**
Issue #32 asks for JVM + Node OTel. **Decision:** ship Node `integration-tests/runner`
+ Agent Gateway MCP instrumentation first (real Hermes→MCP→capability→RCON path),
with env-driven exporters (`none` default so Minecraft QA never depends on a backend).
JVM plugin spans deferred to a follow-up under the same issue/contract — avoid blocking
#32 on Paper plugin shading while the agent platform already emits verifiable traces.
No vendor SDKs (Sentry/Datadog/NR) in this PR; OTLP only.

**D-AP-015 — Biome + commitlint + knip for runner (#35, 2026-08-11).**
**Decision:** Biome is the sole JS format/lint tool for `integration-tests/runner`
(`npm run lint`). Commitlint validates conventional **PR titles** in
`.github/workflows/runner-quality.yml` when the runner changes. Knip gates **critical**
dead-ends (unused files, unused/unlisted deps); unused **export** reporting is off for
now because knip under-detects CommonJS `require` + member access (`tel.foo`) false
positives on intentional public/test APIs. `zod` is a direct dependency (MCP tool schemas).
`typescript` is a knip peer only (ignored as unused app dep). Broader CI (Maven, merge
blocking policy) remains #42; arch-contract remains #36.

**D-AP-016 — CI gates + master branch protection (#42, 2026-08-11).**
**Decision:** ship `.github/workflows/maven-ci.yml` (`maven-test` on Temurin 25 with
nocheatplus installed from the GitHub release jar — jitpack 404 workaround from
`AGENTS.md`) and keep `runner-quality.yml` always present on PRs (path-filter skips
Biome work when JS unchanged so required checks never hang). Integration stays a
**documented** job (`integration-manual`) until a self-hosted Paper runner exists —
do not fake green Minecraft E2E in GHA. Enable `master` branch protection requiring
`maven-test`, `Biome + knip`, and `Conventional PR title`.

**D-AP-017 — Datadog as primary APM via OTLP (#34, 2026-08-11).**
Issue #34 requires choosing Datadog XOR New Relic as the APM backend behind OTel.
**Decision: Datadog is the primary APM;** New Relic remains optional/secondary only if
a future ops need appears — do **not** run both as first-class backends.
**Why Datadog:** existing Cursor Datadog MCP/skills and operator familiarity on this
machine; OTLP HTTP ingest is first-class; keeps one metrics/traces dashboard path.
**How:** export OTLP from the Node runner (and later JVM) to the Datadog agent or
Datadog OTLP intake — **no** Datadog tracing SDK alongside OTel. Staging wiring needs
`DD_API_KEY` / agent endpoint in env or GitHub Secrets (not committed). Minimum
dashboard: scenario latency + error rate (see `docs/OBSERVABILITY.md` § APM).

**D-AP-018 — AI World extends runner; Player actors are citizens (#67, 2026-08-11).**
Do **not** introduce Citizens/Mythic/another NPC plugin as the autonomy runtime.
Autonomous “citizens” are `RawKeepAliveActor` players + server capabilities +
`lib/ai-world` decision/memory/quest loop. Guide villagers in Civs remain static
dialog/housing population. LLM is optional high-level choice only (never per-tick).
Quest planning requires RpgBridge `quest_detail` / `next_quest` (objectives+progress);
POI coordinates remain **BLOCKED** until an observe adapter exists. Construction and
settlement evolution are later milestones; disposable QA worlds only for live runs.

**D-AP-019 — Physical mine progress is RPG state, not break_block alone (#67).**
`Player.breakBlock` is the production event path (fires `BlockBreakEvent` →
RPGServer `handleMineBlock`). Agents must verify progress via `quest_detail` /
`completed_quests` before claiming success. POI coords come from RPG
`DiscoveryRegistry` (`/test rpg pois`); Civs local geography from `/test world nearby`.
QA fixture quest `ai_world_mine_probe` is disposable-only (copy into RPGServer/quests).

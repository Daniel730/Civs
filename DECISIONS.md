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

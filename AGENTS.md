# AGENTS.md

Civs is a Bukkit/Paper RPG plugin (land management via Towns & Regions). It is a
single Maven module that builds one shaded plugin jar (`target/civs-1.11.6.jar`)
which is loaded by a Paper server. Target runtime: **Paper 26.1.2 / Java 25**.

For architecture, workflow, and migration status see `.cursor/skills/civs-paper-migration/SKILL.md`,
`docs/MIGRATION-STATUS.md`, and `README.md`.

## Cursor Cloud specific instructions

The startup update script only refreshes Maven dependencies. The toolchain and a
couple of one-off dependency fixes below are baked into the VM snapshot, so you
normally do NOT need to reinstall them.

### Toolchain (already installed in the snapshot)
- **Java 25** (Temurin) at `/opt/java/current` and **Maven 3.9.9** at `/opt/maven`,
  both exposed via symlinks in `/usr/local/bin` (so `java`/`mvn` work in any shell,
  including non-interactive). `/etc/profile.d/java25.sh` also exports `JAVA_HOME`.
  Note: the distro's apt Java is 21 — do not use it; this project requires Java 25.

### Build / test / run
- Compile + build the plugin jar: `mvn -B -DskipTests package` → `target/civs-1.11.6.jar`.
- Full test suite: `mvn -B test` (293 tests, Mockito 5.23.0 for Java 25).
- Run a subset: `mvn -B test -Dtest=RegionsTests`.
- There is no lint config beyond the compiler; `mvn -B -DskipTests compile` is the
  effective lint gate.

### Known non-obvious gotchas
- **Flaky full-suite test `RegionsTests.dailyRegionShouldUpkeepDaily`**: it can fail
  (e.g. `expected:<420> but was:<310>`) only when the whole suite runs, because the
  `RegionManager`/`TownManager` singletons carry state across tests depending on
  execution order. It passes reliably in isolation (`mvn -B test -Dtest=RegionsTests`
  → 56/56). This is pre-existing and not an environment problem — do not "fix" it as
  part of unrelated work.
- **`nocheatplus` provided dependency**: `com.github.Updated-NoCheatPlus.NoCheatPlus:nocheatplus:1.5`
  is declared as a jitpack dependency, but jitpack returns HTTP 404 for the jar even
  though its build status is "ok" (jitpack eviction of an old multi-module build).
  It is installed into the local Maven repo (`~/.m2`, captured in the snapshot) from
  the upstream GitHub release jar with a stripped pom (no transitive deps). If `~/.m2`
  is ever wiped and the build fails to resolve it, reinstall with:
  ```
  curl -sL -o /tmp/NoCheatPlus.jar https://github.com/Updated-NoCheatPlus/NoCheatPlus/releases/download/v1.5/NoCheatPlus.jar
  printf '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.github.Updated-NoCheatPlus.NoCheatPlus</groupId><artifactId>nocheatplus</artifactId><version>1.5</version><packaging>jar</packaging></project>' > /tmp/ncp-clean-pom.xml
  mvn install:install-file -Dfile=/tmp/NoCheatPlus.jar -DpomFile=/tmp/ncp-clean-pom.xml
  ```
  Do NOT use `mvn dependency:go-offline` to warm dependencies — it ignores pom
  `<exclusion>`s and fails trying to fetch DiscordSRV's transitive `net.dv8tion:JDA`
  from a host not listed in the pom. Use `mvn -DskipTests dependency:resolve` instead
  (this is what the update script runs).

### Running the plugin on a local Paper server
A ready-to-run test server lives at `/workspace/testserver` (git-ignored):
`paper.jar` (Paper 26.1.2 build 72), `plugins/Vault.jar` (hard dependency),
`plugins/Civs.jar`, `eula.txt`, and an offline-mode `server.properties`.
- Rebuild + redeploy the plugin: `mvn -B -DskipTests package && cp target/civs-1.11.6.jar testserver/plugins/Civs.jar`.
- Start it in a tmux session and drive it from the console:
  `cd testserver && java -Xmx2G -jar paper.jar --nogui`.
- Console is OP, so admin actions like `cv reload` and `cv newday` work from the
  server console. Most other `/cv` subcommands need a real player.

### Manual GUI testing with a real client (non-obvious)
For player-facing flows (e.g. the `/cv` menu), connect a real client instead of
the console. The server runs `online-mode=false`, so an offline client joins as
`Player`. The official Minecraft client matching the server exists in the Mojang
manifest (client version == Paper version, e.g. `26.1.2`); download client jar +
Linux libraries/natives + assets from Mojang and launch it in offline mode
(`--accessToken 0 --uuid <offline-uuid> --userType legacy`). The VM has no GPU, so
force software OpenGL: `LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe` (Mesa
llvmpipe gives GL 4.5, enough for Minecraft; expect low FPS). TLauncher's download
CDN (`dl.tlauncher.org`) is not reachable from the VM, so the official client is
the reliable route. `op Player` from the console to give the client full access.
`/cv` opens the Civs main menu; creating a town needs an actual town-type Civs
*item* (economy-backed shop), not just a creative block.

### Testing economy-dependent flows (shop/town/region/auction)
Civs uses Vault for money, so with no economy provider installed `Civs.econ` is
null and shop purchases, town/region buys, taxes, bounties, and auction buys can't
be exercised. To test these locally, drop a minimal Vault `Economy` provider plugin
into `plugins/` (a tiny `JavaPlugin` that `register(Economy.class, ...)` with a
large default balance). Then Civs logs `Hooked into Economy plugin: ...` and the
shop works: `/cv menu` → Shop (emerald) → category → item → top-left emerald "Buy"
→ Confirm. Note `/cv money`/`/cv shop` are NOT commands (shop is menu-only); `/cv`
shows the tutorial path-chooser while a tutorial is active, `/cv menu` forces the
main menu. `/cv advancetut <player>` steps the tutorial (grants reward items).
- The `Civs_servidor/` pack (authoritative production config: menus, item-types,
  towns, regions, translations) can be copied into `plugins/Civs/` to load the full
  config set. Its saved regions/towns reference a specific world UUID, so on a fresh
  world you will see many **expected** `Null world` / "invalid region" load errors —
  Civs safely skips those entries; they are not a bug.

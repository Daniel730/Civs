# Civs autonomous integration-testing framework

A framework for running **real integration tests against a live Paper server** — the code
paths (Bukkit events, scheduler, world/entity state, inventories, persistence) that unit
tests with the mock harness cannot reach. It runs with **zero manual interaction**: start
it, and it drives the server, asserts the plugin's **internal state**, and writes a JUnit
XML report.

> Status: **working prototype in this repo** (`integration-tests/`). A run of the two
> bundled scenarios produces `integration-tests/runner/reports/junit.xml` with 11 passing
> assertions (see [Example scenario](#5-example-autonomous-scenario)).

---

## 1. Recommended architecture

```
Cursor / CI
    │
    ▼
Scenario Generator            integration-tests/runner/scenarios/*.js   (declarative scenarios)
    │
    ▼
Scenario Runner  ──────────►  Mineflayer Actor  (player actions: move, place, click GUI, attack)
 (Node, run.js)                     │                 · works on real Paper ≤1.21.x
    │  RCON                         │                 · UNAVAILABLE on this 26.1.2 server (see §7)
    ▼                               ▼
CivsTestHarness plugin  ◄───────────┘        Paper server (Civs + Vault + economy)
 (server-side, version-proof)
    │  reads INTERNAL state: regions, economy, permissions, blocks, inventories, scheduler
    ▼
Assertions (TEST-OK / TEST-FAIL / TEST-RESULT)
    │
    ▼
JUnit / XML report  ──────►  CI (Jenkins/GitLab/GitHub)
```

**Two-layer design (the key idea).** A bot that only *observes the world* misses silent
bugs. So we split responsibilities:

- **Actor layer (Mineflayer):** performs *player actions* (movement, block place/break,
  GUI clicks, attacks, item pickup). This is what a real player does.
- **Harness layer (server-side plugin, over RCON):** performs *low-level assertions against
  the plugin's internal state* — is the `Region` actually registered in `RegionManager`?
  what does Vault report for the balance? did the block change? This runs inside the JVM
  with direct access to Civs' managers, so it can't be fooled by rendering/latency.

This separation (explicitly recommended in the task) makes tests far less fragile and
turns them into durable long-term regression checks. The harness is also **version-proof**
(compiled against the Paper API), so it works even where the client-side actor doesn't.

The runner talks to the harness over **RCON** — a standard, headless, language-agnostic
channel already built into Paper. No custom network code, no manual steps.

---

## 2. Technology comparison

| Option | Player actions | Internal-state asserts | Works on 26.1.2 here | Verdict |
| --- | --- | --- | --- | --- |
| **MockBukkit (unit)** | n/a (no server) | via mocks only | n/a | Not published for 26.1.x; can't model events/scheduler realistically |
| **Mineflayer** | ✅ rich (pathfinder, digging, windows, PVP) | ❌ only what the client sees | ❌ (see §7) | Best *actor* on real 1.21.x; unusable here |
| **Raw `minecraft-protocol`** | ⚠️ packet-level only | ❌ | ⚠️ logs in, but you'd re-implement mineflayer | Fallback keep-alive client at most |
| **Real client + computer-use** | ✅ (GUI) | ❌ | ✅ but not headless/zero-touch | Good for one-off visual QA, not CI |
| **CivsTestHarness + RCON (this framework)** | ⚠️ via server-side/admin cmds | ✅ **authoritative** | ✅ | **Backbone**: reliable, version-proof, CI-friendly |
| **Harness + Mineflayer (combined)** | ✅ | ✅ | actor gated by version | **Target architecture** on supported servers |

**Decision:** make the **server-side harness the backbone** (assertions + deterministic
setup) and plug **Mineflayer in as the actor** where the protocol is supported. On this
cloud VM (Paper "26.1.2"), the actor is unavailable, so scenarios drive Civs through the
harness and `/cv` admin commands and still assert real internal state.

---

## 3. Prototype implementation

All under [`integration-tests/`](../integration-tests):

- **`test-harness-plugin/`** — the `CivsTestHarness` Paper plugin (Maven; depends on the
  Civs jar like `civs-quests`). Registers `/test` with inspection/assertion subcommands and
  replies in a single machine-parseable line. Highlights:
  - Assertions: `assert economy|region|permission|block|inventory|town`.
  - Queries: `ping`, `money get`, `region at|count`, `held`, `inventory`, `block`, `scheduler`.
  - Control: `money set|add`, `createregion`, `removeregion`, `saveregions`, `reloadregions`,
    `setblock`, `spawnentity`.
  - Runs world/entity access on the primary thread (RCON dispatches there already), reads
    Civs managers directly (`RegionManager`, `TownManager`, `ItemManager`) and Vault.
- **`runner/`** — the Node scenario runner:
  - `lib/harness.js` — typed RCON client for the harness + `/cv`.
  - `lib/scenario.js` — `ScenarioContext` with the required verbs (`exec`, `wait`,
    `waitTicks`, `expect`, `expectEqual`, `expectTrue`) and per-assertion recording.
  - `lib/junit.js` — JUnit XML writer (Jenkins/GitLab/GitHub compatible).
  - `lib/actor-mineflayer.js` — optional Mineflayer actor (version-gate patch + graceful
    fallback when unsupported).
  - `run.js` — connect → run scenarios → write JUnit → exit non-zero on failure.
  - `scenarios/*.js` — declarative scenarios.

**Framework verbs → implementation**

| Required verb | Provided by |
| --- | --- |
| setup() / cleanup() | `scenario.setup(ctx)` / `scenario.cleanup(ctx)` |
| reset world / spawn player / teleport | harness `removeregion`/`setblock`; `harness.teleport`; actor spawn (when available) |
| execute command | `ctx.exec(cmd)` / `harness.cv(...)` (RCON) |
| wait ticks | `ctx.waitTicks(n)` (20 tps) |
| assert inventory / block / region / economy / permission | `harness.assert.*` |
| assert chat | actor `messagestr` (when actor available) |

---

## 4. Repository layout

```
integration-tests/
├── README.md
├── test-harness-plugin/                 # server-side plugin (Maven)
│   ├── pom.xml                          # system-scoped Civs dep (../../target/civs-1.11.7.jar)
│   └── src/main/
│       ├── java/org/civs/itest/harness/TestHarnessPlugin.java
│       └── resources/plugin.yml
└── runner/                              # Node scenario runner
    ├── package.json                     # rcon-client (+ optional mineflayer)
    ├── run.js                           # entrypoint
    ├── lib/{harness,scenario,junit,actor-mineflayer}.js
    ├── scenarios/                       # one file per scenario
    │   ├── 01-region-persistence.js
    │   └── 02-economy-world-state.js
    └── reports/junit.xml                # generated (git-ignored)
```

The Civs build (`pom.xml`, `src/`) is **untouched**; the harness is a separate Maven
project, so `mvn test`/`package` for Civs is unchanged.

### Build & run
```bash
# 1. Build Civs (produces target/civs-1.11.7.jar the harness links against)
mvn -DskipTests package
# 2. Build the harness plugin, deploy to the test server's plugins/
cd integration-tests/test-harness-plugin && mvn -o package
cp target/CivsTestHarness.jar /path/to/testserver/plugins/
# 3. Enable RCON in server.properties: enable-rcon=true, rcon.password=civs-itest, rcon.port=25575
#    (start the server as usual)
# 4. Run the framework
cd ../runner && npm install && node run.js         # -> reports/junit.xml, exit 0/1
```

---

## 5. Example autonomous scenario

`scenarios/01-region-persistence.js` — proves **serialization + reload on a live server**,
which unit tests cannot:

```js
async run(ctx) {
  const before = await ctx.harness.region.count('shelter');
  const created = await ctx.harness.region.create('shelter', 500, -60, 500);
  ctx.expectEqual('createregion returns the region type', created.created, 'shelter');
  ctx.expect('region exists at target coords', await ctx.harness.assert.region('shelter', 500, -60, 500));
  ctx.expectEqual('region count incremented by one', await ctx.harness.region.count('shelter'), before + 1);

  await ctx.harness.region.save();          // write to disk (AsyncFileWriter)
  await ctx.wait(1000);
  const reload = await ctx.harness.region.reload();   // reload the region set FROM disk
  ctx.expect('region PERSISTS after reload from disk', await ctx.harness.assert.region('shelter', 500, -60, 500));
}
```

Actual run output (both bundled scenarios, zero manual interaction):

```
=== Scenario: RegionPersistence ===
  PASS  createregion returns the region type — expected=shelter actual=shelter
  PASS  region exists at target coords — region shelter present at 500,-60,500
  PASS  region count incremented by one — expected=3 actual=3
  PASS  reload loaded regions from disk — TEST-RESULT reloaded regions=3
  PASS  region PERSISTS after reload from disk — region shelter present at 500,-60,500
=== Scenario: EconomyAndWorldState ===
  PASS  economy balance set to 5000 / >= 7500 after add / <= 8000 (no overflow)
  PASS  placed block is DIAMOND_BLOCK
  PASS  cow entity spawned — uuid=d5f3192c-...
  PASS  civs scheduler pending-task count is readable — civsPendingTasks=5
TOTAL: 11 assertions, 0 failed, 0 scenario error(s).
```

---

## 6. CI integration strategy

The runner exits non-zero on any failure and writes JUnit XML, so it drops into any CI:

1. **Build stage:** `mvn -DskipTests package` (Civs) then `mvn -o package` (harness).
2. **Provision stage:** download Paper (v3 fill API — see `README.md`), copy `Civs.jar`,
   `Vault.jar`, an economy provider, and `CivsTestHarness.jar` into `plugins/`, write
   `eula.txt` and an RCON-enabled `server.properties`. (Scriptable; see `AGENTS.md`.)
3. **Boot stage:** start Paper headless; wait for `Done (` and `RCON running` in the log.
4. **Test stage:** `cd integration-tests/runner && npm ci && node run.js`.
5. **Report stage:** publish `integration-tests/runner/reports/junit.xml`
   (GitHub: `dorny/test-reporter`/`mikepenz/action-junit-report`; GitLab: `artifacts:reports:junit`;
   Jenkins: `junit` step). Fail the job on the runner's non-zero exit.

Recommended as a **separate CI job** from unit tests (needs a booted server; slower).
Cache `~/.m2` and the Paper jar. Gate merges on unit tests; run integration nightly + on
labels for speed. A `docker-compose` (Paper + harness) service makes this reproducible.

---

## 7. Limitations

- **Mineflayer cannot drive this Paper 26.1.2 server (empirically verified).** Its version
  allowlist caps at `1.21.11`; patched past that, its high-level plugins assume 1.x packet
  shapes and crash (`time` plugin) or never emit `spawn`. Raw `minecraft-protocol` *does*
  log in (minecraft-data ships 26.1 data), but rebuilding movement/inventory/GUI on raw
  packets ≈ reimplementing Mineflayer. **On a real Paper 1.21.x server, Mineflayer works
  fully** and the actor layer is enabled (`ACTOR=1`, `MC_SERVER_MAJOR=1.21`). Full probe log:
  `integration-tests/MINEFLAYER-PROBE-RESULTS.txt`.
- **Consequences here:** GUI-click, real block-place-by-player, pathfinding, and combat
  scenarios need the actor and are therefore *designed but not runnable on 26.1.2 in this
  VM*. They run on supported servers. Meanwhile the harness covers placement/economy/
  permissions/persistence/scheduler/world-state via server-side APIs.
- **RCON runs on the primary thread**, so harness handlers must not block on
  `callSyncMethod().get()` (deadlock); the harness detects `isPrimaryThread()` and calls
  world APIs directly. Long operations (cold chunk generation) should be avoided or use
  near-spawn/loaded coordinates.
- **Server-side region creation** (`createregion`) uses a synthetic owner and bypasses the
  block-placement/BlockPlaceEvent pipeline — great for persistence/economy tests, but the
  *placement validation* path still needs the actor (or `/cv placeregion` with an online
  player).
- **Determinism:** scenarios should clean up (remove regions, reset blocks) and use isolated
  coordinates; the harness provides `removeregion`/`setblock`/`reloadregions` for teardown.

---

## 8. Incremental roadmap

1. **Now (done):** harness plugin + RCON runner + JUnit XML + 2 scenarios (persistence,
   economy/world-state) green.
2. **Harness breadth:** add `assert region owner/member`, `region effects <id>`, town
   create/assert, auction listing/purchase inspection, serialized-YAML dump
   (`/test dump region <id>`), permission grant/revoke, and `/test tick <n>` via a
   controllable test scheduler for cooldown/upkeep tests.
3. **Actor enablement:** wire Mineflayer scenarios for real 1.21.x (move → place blocks →
   `/cv` create town/region → GUI open/click → assert via harness). Add `mineflayer-pathfinder`.
4. **Scenario library:** cover the requested flows — create town, claim land, build
   structure, open GUI, purchase item, trigger siege/TNT/conveyor/AntiCamp/AllowedActions,
   auction flow, economy payment, territorial ownership, region destruction, save/restart/
   reload persistence. Group by shared setup via fixtures/builders.
5. **Restart persistence:** add a scenario that stops+starts the server (not just
   `reloadregions`) and re-asserts — the strongest persistence guarantee.
6. **CI:** dockerized Paper+harness service, nightly job, JUnit publishing, flaky-retry.
7. **Reporting:** attach server logs on failure; optional screenshot via the real client for
   GUI scenarios.

---

## Appendix — `/test` command reference

| Command | Reply |
| --- | --- |
| `/test ping` | `TEST-RESULT pong=1 civs=<bool> economy=<bool>` |
| `/test money get\|set\|add <player> [amt]` | balance result / OK |
| `/test assert economy <player> <eq\|ge\|le> <amt>` | TEST-OK / TEST-FAIL |
| `/test createregion <type> <x> <y> <z> [world]` | `TEST-RESULT created=<type> id=<id>` |
| `/test removeregion <x> <y> <z> [world]` | `TEST-RESULT removed=<0\|1>` |
| `/test saveregions` / `/test reloadregions` | OK / `regions=<n>` |
| `/test region at <x> <y> <z> [world]` | type/owners/forsale/exp/effects or `region=none` |
| `/test region count <type>` | `TEST-RESULT count=<n>` |
| `/test assert region <type> <x> <y> <z> [world]` | TEST-OK / TEST-FAIL |
| `/test setblock <x> <y> <z> <MATERIAL> [world]` | `TEST-RESULT material=<mat>` |
| `/test block <x> <y> <z> [world]` / `assert block ...` | material / TEST-OK\|FAIL |
| `/test spawnentity <TYPE> <x> <y> <z> [world]` | `TEST-RESULT spawned=<type> uuid=<uuid>` |
| `/test held\|inventory <player>` / `assert inventory <player> <MAT> [min]` | items / TEST-OK\|FAIL |
| `/test permission <player> <node>` / `assert permission <player> <node> <bool>` | value / TEST-OK\|FAIL |
| `/test assert town <name> exists` | TEST-OK / TEST-FAIL |
| `/test scheduler` | `TEST-RESULT civsPendingTasks=<n>` |

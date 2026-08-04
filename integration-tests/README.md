# Civs integration tests

Autonomous integration-testing framework that runs **real tests against a live Paper
server** and asserts Civs' **internal state**. Full design, architecture, tech comparison,
CI strategy, limitations, and roadmap: [`../docs/INTEGRATION-TESTING.md`](../docs/INTEGRATION-TESTING.md).

Two parts:
- `test-harness-plugin/` — the `CivsTestHarness` Paper plugin exposing `/test` inspection
  and assertion commands (the version-proof backbone).
- `runner/` — a Node scenario runner that drives the server over RCON (and optionally a
  Mineflayer player actor), running `scenarios/*.js` and emitting JUnit XML.

## Quick start

```bash
# From the repo root:
mvn -DskipTests package                                   # build Civs (jar the harness links)
cd integration-tests/test-harness-plugin && mvn -o package
cp target/CivsTestHarness.jar <testserver>/plugins/

# server.properties: enable-rcon=true, rcon.password=civs-itest, rcon.port=25575
# start the server, then:
cd ../runner && npm install && node run.js               # -> reports/junit.xml, exit 0/1
node run.js --scenario region                             # run a single scenario by filename
```

Config via env: `RCON_HOST/RCON_PORT/RCON_PASSWORD`, `MC_HOST/MC_PORT`, `ACTOR=1` to enable
the Mineflayer actor, `MC_SERVER_MAJOR=1.21` (actor version hint), `REPORT=<path>`.

## Add a scenario (DSL)

Drop a file in `runner/scenarios/` that exports a built DSL scenario. Actions are performed
by the **actor** (production code); expectations are checked by the **harness** (observation):

```js
const { scenario } = require('../lib/dsl');
module.exports = scenario('MyScenario')
  .player('Steve')                          // real online player, OP'd
  .placeRegion('shelter', 500, -60, 500)    // actor -> /cv placeregion -> production pipeline
  .expectRegion('shelter', 500, -60, 500)   // harness observes internal state
  .expectNoErrors()
  .resetRegion(500, -60, 500)               // teardown
  .build();
```

Actions: `.player .teleport .placeRegion .give .runCommand`. Expectations:
`.expectRegion .expectRegionCount .expectMoney .expectPermission .expectBlock .expectNoErrors`.
Arrange/teardown: `.arrangeMoney .arrangeBlock .saveRegions .reloadRegions .resetRegion
.resetBlock .wait .waitTicks .step`. On failure, an evidence bundle is written to
`reports/evidence/<scenario>/`.

> Architecture rule: the harness **observes and resets**; it never creates Civs game state.
> That's the actor's job, so the real event chain is exercised (see the design doc).

> Note: on this cloud VM the server is Paper "26.1.2", which Mineflayer cannot drive
> (see the design doc §7 and `MINEFLAYER-PROBE-RESULTS.txt`). Scenarios therefore assert
> via the harness; the actor layer activates on real Paper ≤1.21.x servers.

# QA Agents

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Purpose

Autonomous agents that validate Civs + RPGServer behavior with evidence, not claims.

## Existing paths (FACT)

| Path | How | Good for |
|------|-----|----------|
| Unit tests (`mvn test`) | Mockito harness | Pure logic, menus, region math |
| Integration runner | RCON + actor + `/test` | Live persistence, economy, regions |
| `scripts/qa` fast path | RCON place/I/O | Structure activation throughput |
| Real client + window bot | Computer-use / pyautogui | GUI click geometry |
| Admin commands | `/cv give`, `/cv placeregion` | Deterministic structure setup |

## Deterministic scenario agent (current)

Entry: `integration-tests/runner/run.js`

Flow:

```text
boot Paper → connect harness → connect RawKeepAliveActor → run scenarios/*.js → JUnit + evidence
```

Assertions must use harness observation. Actions must use actor/capabilities (production paths).

## Exploratory LLM QA agent (TODO)

Goals examples: warrior progression, quest persistence exploits, death/reward inconsistencies.

Constraints:

- Plans execute only through verified capabilities.
- No arbitrary `/` server commands from raw model text.
- Pass/fail requires evidence bundle (logs, snapshots, coordinates, inventory).

## Bug reports

On failure, write machine + human readable artifacts under
`integration-tests/runner/reports/evidence/<scenario>/` (FACT: already implemented).

Required fields for new reports (TODO extend schema):

```text
scenario, agent, server version, plugin versions, commit, timestamp,
steps, expected, actual, events, logs, player state, coords, inventory,
quest state, reproduction steps
```

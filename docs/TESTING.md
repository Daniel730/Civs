# Testing

Labels: **FACT** · **OBSERVED** · **UNKNOWN** · **TODO**

## Layers

| Layer | Command / entry | Status |
|-------|-----------------|--------|
| Unit | `mvn test` (Civs) | FACT: large suite on master |
| Integration | `integration-tests/runner` + live Paper | FACT: 2 scenarios documented green |
| Structure fast QA | `scripts/qa/run_all.py fast` | FACT: WSL-oriented |
| Capability probes | `node` scenarios + `/test act` | TODO → in progress |
| Long-running soak | TODO | — |

## Integration runner config

| Env | Default (docs) | WSL QA OBSERVED |
|-----|----------------|-----------------|
| `RCON_HOST` | 127.0.0.1 | 127.0.0.1 (from Windows via WSL port forward / localhost) |
| `RCON_PORT` | 25575 | 25575 |
| `RCON_PASSWORD` | `civs-itest` | **`civsqa`** |
| `MC_PORT` | 25565 | 25565 |
| `ACTOR` | 1 | 1 |
| `SERVER_LOG` | `/tmp/paper.log` | `/home/dansilva/civs-testserver/logs/latest.log` |

## Definition of done (behavioral)

A capability or scenario is not done at “files created”. Use:

`IMPLEMENTED → BUILT → UNIT TESTED → INTEGRATION TESTED → E2E TESTED → EMPIRICALLY VALIDATED → PRODUCTION READY`

## Known flaky / pitfalls

- FACT (`AGENTS.md`): `RegionsTests.dailyRegionShouldUpkeepDaily` can fail in full suite due to singleton state.
- FACT: `/cv reload` does not reload Java code — restart required.
- FACT: Mineflayer actor unavailable on 26.1.2.

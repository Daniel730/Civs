# Testing

Labels: **FACT** · **OBSERVED** · **UNKNOWN** · **TODO**

## Layers

| Layer | Command / entry | Status |
|-------|-----------------|--------|
| Unit | `mvn test` (Civs) | FACT: large suite on master; **CI:** `.github/workflows/maven-ci.yml` (`maven-test`) |
| Runner lint / knip / Node unit | `cd integration-tests/runner && npm run lint && npm run knip && npm run test:unit` | FACT: **CI:** `.github/workflows/runner-quality.yml` |
| Integration | `integration-tests/runner` + live Paper | FACT: scenarios documented green; **CI job is documented manual** (`integration-manual`) until self-hosted Paper exists |
| Structure fast QA | `scripts/qa/run_all.py fast` | FACT: WSL-oriented |
| Capability probes | `node` scenarios + `/test act` | TODO → in progress |
| Long-running soak | TODO | — |

## CI gates (#42)

| Check name | When | Blocks merge on `master`? |
|------------|------|---------------------------|
| `maven-test` | Every PR / push (Temurin 25; nocheatplus installed from GitHub release) | **Yes** (branch protection) |
| `Biome + knip` | Every PR (skips work if runner paths unchanged, still reports success) | **Yes** |
| `Conventional PR title` | Every PR | **Yes** |
| `integration-manual (documented)` | Every PR | No (documentation-only until self-hosted) |

**Integration (manual / self-hosted):** see “Integration runner config” below and `docs/AGENT_PLATFORM.md`. Do not invent a second harness; Hermes must not talk RCON directly.

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

# Operations

Labels: **FACT** · **OBSERVED** · **UNKNOWN** · **TODO**

## Build / deploy (Civs)

```powershell
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" -B -DskipTests package
# → target/civs-1.11.7.jar
```

Harness:

```powershell
cd integration-tests/test-harness-plugin
& "C:\Users\Danie\tools\apache-maven-3.9.10\bin\mvn.cmd" -B -DskipTests package
# → target/CivsTestHarness.jar  (verify finalName in pom)
```

## WSL QA testserver (OBSERVED)

- Path: `/home/dansilva/civs-testserver`
- Control: `scripts/_tmux_server.sh {start|stop|wait-boot|status|cmd|log}`
- Plugins seen: Civs 1.11.7, RPGServer 0.1.2, Vault, TestEconomy, WorldEdit 7.4.3, spark
- RCON: port 25575, password `civsqa`
- online-mode=false, gamemode=creative (OBSERVED)

**Safety:** this is the preferred sandbox for capability probes. Do not point destructive agents at production.

## Health signals (target)

| Signal | How today | TODO |
|--------|-----------|------|
| Server up | tmux session / log `Done (` | watchdog |
| RCON | `test ping` | — |
| Actor connected | runner log | — |
| Camera / Director / OBS | n/a | P6–P7 |

## Resource knobs (TODO implement)

`max agents`, LLM cooldown, decision frequency, pathfinding frequency, observation frequency, memory limits, camera update rate.

## Recovery principles

- Graceful reconnect for actors; no uncontrolled restart storms.
- Evidence capture before teardown.
- Circuit-break repeated capability failures.

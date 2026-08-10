# Observability — OpenTelemetry (Civs)

**Primary contract:** OpenTelemetry is the **only** instrumentation layer.  
Sentry (errors) and Datadog **or** New Relic (APM) may consume OTLP later — they are backends, not parallel SDKs. See `DECISIONS.md` D-AP-013 and `docs/AGENT-WORKFLOW.md` §2.

**Scope for #32:** Node `integration-tests/runner` (scenarios, capabilities, RCON, Agent Gateway MCP). JVM plugin spans remain follow-up (same OTLP contract).

---

## Status vocabulary

Capability / MCP envelopes use: `OBSERVED` | `PASS` | `FAIL` | `BLOCKED` | `UNKNOWN`.  
These are copied onto span attribute `result.status` so backends can filter without inventing a second enum.

| Status | Span status | Meaning |
|--------|-------------|---------|
| `PASS` | OK | Verified success |
| `OBSERVED` | OK | State seen; not a pass/fail assertion |
| `FAIL` | ERROR | Capability/assertion failed |
| `BLOCKED` | ERROR | Cannot run (e.g. player offline) |
| `UNKNOWN` | unset | Ambiguous / unparsed |

---

## Environment

| Variable | Effect |
|----------|--------|
| *(unset)* | **No exporter** — telemetry is a no-op. Minecraft QA unchanged. |
| `OTEL_SDK_DISABLED=true` | Force no-op |
| `OTEL_SERVICE_NAME` | Resource `service.name` (default `civs-integration-runner` / `civs-agent-gateway`) |
| `OTEL_TRACES_EXPORTER=none\|console\|otlp\|memory\|file` | Exporter mode |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP HTTP endpoint (implies `otlp` if exporter unset) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Full traces URL (overrides) |
| `CIVS_OTEL_IN_MEMORY=1` | Keep spans in-process (unit tests / local inspect) |
| `CIVS_OTEL_FILE=/path/spans.jsonl` | Append JSONL span records (local inspect, no collector) |
| `CIVS_OTEL_CONSOLE=1` | Also print spans to stdout |
| `AGENT_ID` / `AGENT_ROLE` | Optional `agent.id` / used by runner role attrs |

**Never** put RCON passwords, tokens, or API keys in attributes. The runner redacts keys matching `password|secret|token|api_key|…`.

---

## Local / CI recipes

### No exporter (default CI Minecraft QA)

```bash
cd integration-tests/runner
node run.js --scenario 07-move-to
# Telemetry silent; tests must not fail because of OTel
```

### In-memory + file inspect (recommended local validation)

```bash
cd integration-tests/runner
set CIVS_OTEL_IN_MEMORY=1
set CIVS_OTEL_FILE=reports/otel-spans.jsonl
npm run test:otel-validate
npm run test:otel-validate -- --mcp
npm run test:unit
```

### Console exporter

```bash
set OTEL_TRACES_EXPORTER=console
node run.js --scenario 07-move-to
```

### OTLP → local collector

```bash
# Example collector receives OTLP/HTTP on 4318
set OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
set OTEL_TRACES_EXPORTER=otlp
node run.js --scenario 07-move-to
```

If the collector is down, the runner **must not** fail Minecraft assertions; export errors are swallowed by the BatchSpanProcessor / init fallbacks.

---

## Span names (runner)

| Span | Where |
|------|--------|
| `runner.session` | `run.js` |
| `scenario.run` / `scenario.setup` / `scenario.step` / `scenario.assertion` / `scenario.retry` | scenario + DSL |
| `minecraft.capability.*` / `minecraft.move_to` | capabilities |
| `rcon.connect` / `rcon.send` / `rcon.close` | harness |
| `actor.connect` / `actor.teleport` / … | RawKeepAliveActor |
| `mcp.tool` / `gateway.lifecycle` | Agent Gateway MCP |

Expected parent/child for navigation QA:

`scenario.run` → `scenario.step` → `minecraft.move_to` → `rcon.send`

With MCP (Hermes or smoke client):

`mcp.tool` → (capability spans) → `rcon.send`

---

## Tests

```bash
npm run test:unit          # secrets, nesting, failure recording, optional no-op
npm run test:otel-validate # empirical tree without Paper server
```

Live Paper: set `CIVS_OTEL_FILE` and run a real scenario / `gateway/smoke.js`; inspect JSONL for the same tree.

---

## What is intentionally out of scope here

- Sentry bridge → issue #33  
- Datadog XOR New Relic OTLP backend → issue #34  
- JVM plugin spans → same contract, later PR under #32 or follow-up if split  
- Hermes/LLM request spans — only when the integration exposes a clear boundary (MCP tool entry is instrumented; Hermes process internals are not)

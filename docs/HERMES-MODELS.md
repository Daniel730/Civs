# Hermes model roles (Windows Civs QA)

Labels: **FACT** · **OBSERVED** · **INFERRED** · **BLOCKED**

Configured / probed 2026-08-10 against Windows Hermes **v0.19.0** and Ollama
on Tailscale `desktop-vioren5-1` (`100.69.136.92:11434`). Machine-local Hermes
home is `C:\Users\Danie\AppData\Local\hermes\` — not committed.

Policy YAML: `integration-tests/runner/gateway/model-policy.yaml`  
Companion fragment: `integration-tests/runner/gateway/hermes-models.yaml`.

---

## Role → model mapping (benchmarked)

| Role | Preferred | Fallback | Why |
|------|-----------|----------|-----|
| **fast_agent** (default Minecraft MCP loops) | `hermes-fast` | `hermes-agent` | Focused probes: PONG + chose `minecraft_rpg_observe` first; lighter 9.7B fits 12GB with Paper. |
| **planner** | `hermes-fast` | `hermes-qwen14` | Same family; qwen14 only after fresh probe under low contention. |
| **qa_explorer** | `hermes-fast` | `hermes-agent` | Same evidence as fast_agent. |
| **code_analysis** | `hermes-coder` | `hermes-qwen14` | **Not** default Minecraft brain — recovery probes hallucinated tool names. |
| **vision** | `hermes-fast` | — | Has vision capability; keep vision toolset **disabled** unless needed (mmproj + ctx 65536 pinned ~9.5GB VRAM). |
| **director** | — | — | Omitted — unprobed / not required for P1. |

**Never silent-switch** to an unprobed model. Re-run `scripts/_probe_focused.py` after Ollama/model changes.

---

## Probe table (2026-08-10, short `num_ctx=4096`, `think=false`)

| Model | PONG | Tool-text (observe-first) | FAIL recovery | Native OpenAI tool_calls | Notes |
|-------|------|---------------------------|---------------|--------------------------|-------|
| `hermes-fast-mc` | PASS ~55s load / content `PONG` | PASS `minecraft_rpg_observe` | prose (no tool) | text-form tools | Best local API; **Hermes rejects** (<64k ctx) |
| `hermes-agent-mc` | PASS | PASS observe-first | **hallucinated** `get_available_quests` | empty | Do not prefer for recovery |
| `hermes-coder-mc` | PASS | PASS observe-first | **hallucinated** `minecraft_rpg_check_quests` | text-form | code_analysis only |
| `hermes-fast` | PASS | PASS observe-first | prose | — | **Selected default** (Hermes ≥64k) |
| `hermes-agent` | incomplete under bot-server contention | — | — | — | Fallback only |

Short-ctx aliases (`ollama create *-mc` with `PARAMETER num_ctx 8192`) remain useful for raw API / forge probes; Hermes v0.19 requires `model.context_length >= 65536`.

---

## Windows Hermes config (OBSERVED working for -z + MCP)

```yaml
model:
  provider: custom
  default: hermes-fast
  base_url: http://100.69.136.92:11434/v1
  api_key: no-key
  context_length: 65536
moa:
  enabled: false
mcp_discovery_timeout: 60
platform_toolsets:
  cli: [hermes-cli, minecraft-qa]
agent:
  max_turns: 20
  disabled_toolsets: [browser, computer_use, image_gen, vision, tts, web, delegation,
                      cronjob, session_search, skills, code_execution, terminal, file]
```

### Critical local patch (FACT)

`hermes -z` backgrounds MCP discovery and did **not** wait — model saw only clarify/memory/todo.
Patched `hermes_cli/oneshot.py` to call `wait_for_mcp_discovery()` before agent start.
See `integration-tests/runner/gateway/patches/hermes-oneshot-wait-mcp.patch`.

### Ops notes

- Hostname `desktop-vioren5-1` often fails Windows DNS — use Tailscale IP (**OBSERVED**).
- `127.0.0.1:11434` refused on Windows — Ollama listens in WSL (**FACT**).
- systemd override (**FACT**): `OLLAMA_CONTEXT_LENGTH=65536`, `OLLAMA_KEEP_ALIVE=24h` — needs **sudo** to lower (recommended 8192–16384 + `5m` keep-alive).
- Concurrent bot-server `hermes -z` floods starve the GPU — clear before Minecraft E2E (`scripts/_clear_ollama_contention.sh`).

### Override per invocation

```text
hermes -z "…" -m hermes-fast --yolo --ignore-rules
# from a neutral cwd; do NOT use -t clarify,todo,memory alone (drops MCP)
```

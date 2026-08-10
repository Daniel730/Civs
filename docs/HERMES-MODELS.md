# Hermes model roles (Windows Civs QA)

Labels: **FACT** · **OBSERVED** · **INFERRED**

Configured on this host 2026-08-10 against Windows Hermes **v0.19.0** and Ollama
on Tailscale `desktop-vioren5-1` (`100.69.136.92:11434`). Machine-local Hermes
home is `C:\Users\Danie\AppData\Local\hermes\` — not committed.

Companion YAML fragment for scripts: `integration-tests/runner/gateway/hermes-models.yaml`.

---

## Role → model mapping

| Role | Model (`-m`) | Provider / endpoint | Why |
|------|--------------|---------------------|-----|
| **Default / exploratory Minecraft agent** (tool loops, MCP gameplay) | `hermes-agent` | `custom` → `http://100.69.136.92:11434/v1` | Local Ollama tool-calling model; reachable from Windows via Tailscale IP. Prefer over broken MoA/`poolside/laguna-s-2.1:free`. |
| **Cheap summaries** | `hermes-fast` | same custom Ollama | Smaller/faster; use for list/summarize oneshots. |
| **Coding patches** | `hermes-coder` | same custom Ollama | Forge/orchestration coding tier; available on this Ollama. |
| **Heavier alt** | `hermes-qwen14` | same custom Ollama | Optional when agent/coder underperform; not the default. |

**Fallback if Ollama unreachable:** Nous Portal remains logged in on this machine
(`hermes status`). Switch with `hermes config set model.provider nous` and pick a
live Portal model via `hermes model` (interactive) — do **not** re-enable MoA until
a valid MoA preset exists (`hermes moa list` currently only has `default`).

**Do not use for Minecraft QA by default:** bot-server SSH Hermes — Ollama is on
this PC; MCP gateway talks to local Paper/RCON. bot-server was idle/online but is
the wrong host for local RCON until a tunnel is proven.

---

## Windows Hermes config (OBSERVED working)

```yaml
model:
  provider: custom
  default: hermes-agent
  base_url: http://100.69.136.92:11434/v1   # Tailscale IP of desktop-vioren5-1
  api_key: no-key
  context_length: 65536
```

Notes:
- Hostname `desktop-vioren5-1` did **not** resolve from Windows DNS (**OBSERVED**);
  Tailscale IP did. Prefer IP (or fix MagicDNS / hosts) for Windows Hermes.
- `127.0.0.1:11434` refused on Windows — Ollama listens in WSL, not Win host.
- MoA left disabled (`moa.enabled: false`); broken preset was the prior `-z` blocker.

### Override per invocation

```text
hermes -z "…" -m hermes-fast --yolo
hermes -z "…" -m hermes-coder --yolo
hermes -z "…" -m hermes-agent --yolo
```

---

## Probe results (2026-08-10)

| Check | Result | Label |
|-------|--------|-------|
| `hermes -z "Reply with exactly PONG"` (default `hermes-agent`) | stdout `PONG`, exit 0 | **PASS** |
| Ollama `/v1/models` via `100.69.136.92:11434` | includes hermes-agent/fast/coder/qwen14 | **FACT** |
| `hermes mcp list` / `hermes mcp test minecraft-qa` | 10 tools, connected | **PASS** |
| Oneshot (hermes-fast) asked to name minecraft-qa tools without calling them | listed `mcp__minecraft_qa__minecraft_*` names (minor OCR/typo in reply) | **OBSERVED** |

# Hermes Agent — installation recon & integration plan

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO** · **PASS** · **BLOCKED**

Investigation / config date: 2026-08-10. No APIs invented — all invocation shapes taken from `hermes --help` / subcommand help / local docs.

Role → model mapping: **`docs/HERMES-MODELS.md`** (+ `integration-tests/runner/gateway/hermes-models.yaml`).

---

## 1. What is installed

### Windows (primary for this Cursor host)

| Item | Value | Label |
|------|-------|-------|
| CLI | `C:\Users\Danie\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe` (also on PATH as `hermes`) | FACT |
| Alias | `hermes-agent.exe` same venv | FACT |
| Version | **Hermes Agent v0.19.0** · dump build `240afd0b` (2026-07-29) | FACT (`hermes dump` / `--version`) |
| Install dir | `C:\Users\Danie\AppData\Local\hermes\hermes-agent` | FACT |
| Install method | git | FACT |
| Home / config | `C:\Users\Danie\AppData\Local\hermes\` (`config.yaml`, `SOUL.md`, sessions, skills) | FACT |
| Python | 3.11.15 | FACT |
| Configured model | `hermes-fast` via **custom** OpenAI-compatible Ollama `http://100.69.136.92:11434/v1` | **FACT** (benchmarked; see `docs/HERMES-MODELS.md`) |
| MCP servers configured | `minecraft-qa` (10 tools, enabled) | **PASS** (`hermes mcp list` / `mcp test`) |

### WSL (dansilva)

| Item | Value | Label |
|------|-------|-------|
| CLI | `/home/dansilva/.local/bin/hermes` → venv under `~/.hermes/hermes-agent` | FACT |
| Version | **v0.18.0 (2026.7.1)** (older than Windows) | FACT |
| Home | `/home/dansilva/.hermes/` | FACT |
| Node (for MCP bridge) | `/home/dansilva/.nvm/versions/node/v25.8.0/bin/node` | FACT |

### Related (not the Minecraft QA host)

| Item | Value | Label |
|------|-------|-------|
| `daniel-hermes-forge` | `C:\Users\Danie\Projects\daniel-hermes-forge` — profile export + `hermes_delegate.py` | FACT |
| Forge delegation | SSH `daniel@bot-server` then `hermes --yolo -m <model> -z '…'` | FACT |
| bot-server | Tailscale online (idle); still **not** default for local MC MCP/RCON | OBSERVED |
| Ollama | WSL Tailscale `desktop-vioren5-1` / `100.69.136.92:11434` — models hermes-agent/fast/coder/qwen14 | **PASS** |

**Decision for Civs QA:** drive exploration from the **Windows Hermes v0.19.0** on this machine (same host that talks to WSL Paper QA over localhost), unless/until Tailscale routing of RCON from bot-server is proven.

---

## 2. Official ways to invoke Hermes programmatically

From `hermes --help` / `hermes chat --help` / `hermes mcp --help` / `hermes serve --help` / `hermes acp --help`:

| Mechanism | Command / shape | Suitable for Cursor→Hermes gameplay? |
|-----------|-----------------|--------------------------------------|
| **One-shot CLI** | `hermes -z/--oneshot "prompt"` (+ optional `--usage-file`) | **Yes** — stdout = final text only; tools/memory load; approvals auto-bypassed |
| **Chat query** | `hermes chat -q "…" -Q` | Yes — quiet programmatic mode |
| **MCP client** | `hermes mcp add <name> --command … --args …` or `--url` | **Yes** — official way to attach **external tools** (our harness) |
| **MCP server (Hermes)** | `hermes mcp serve` | No for our tools — exposes Hermes *conversations* to other agents (stdio), not Minecraft tools |
| **Backend serve** | `hermes serve [--port 9119]` | Desktop/remote JSON-RPC/WS gateway — heavier; not required for first bridge |
| **ACP** | `hermes acp` | Editor protocol (VS Code/Zed) — not our primary path |
| **Gateway / send** | messaging platforms | Out of scope for QA harness |
| Forge SSH delegate | `hermes_delegate.py` → bot-server `-z` | Useful for Ollama reasoning; wrong default for local MC tools until network proven |

Tool calling: Hermes is described as an “AI assistant with tool-calling capabilities”; built-in toolsets include `terminal`, `file`, `web`, etc. MCP tools appear as `server:tool` (`hermes tools list` help text) / `mcp__…` in model-facing schemas. **FACT.**

Non-interactive config: `hermes config set <key> <value>` (**FACT** from `hermes config --help`). Prefer that over interactive `hermes model` when scripting.

---

## 3. Limitations & current status (do not paper over)

1. **No Minecraft awareness in Hermes itself** — must receive tools/skills that call our harness.
2. **`hermes -z` can emit tool-call JSON instead of a final answer** on some models (documented in forge `ORCHESTRATION.md`) — exploratory runner must treat that as `BLOCKED`/`UNKNOWN`, not PASS.
3. **Windows vs WSL Hermes versions differ** (0.19 vs 0.18) — pin integrations to Windows CLI for this repo’s Cursor sessions.
4. **Nous / MoA auth expires** — Portal was still logged in at config time; MoA preset path remains broken if re-enabled without a valid preset.
5. **Do not grant Hermes raw shell to RCON** as the integration — that violates “LLM decides WHAT, harness decides HOW” and reintroduces fake-success (`performCommand` lesson).
6. **bot-server path** is a second Hermes; using it for Minecraft QA requires an extra network probe (UNKNOWN until tested).
7. **Windows has no `node.exe` on PATH** — MCP stdio must use WSL node bridge (**FACT**).
8. **`hermes mcp add` is interactive** for tool enable (`Enable all N tools? [Y/n/select]`). Non-interactive: pipe `Y` on stdin (**OBSERVED**). There is no `--yes` flag in `hermes mcp add --help`.
9. **Windows `--env` alone may not reach Node inside WSL** — put `KEY=VAL` on the WSL command via `wsl.exe -e env …` (**OBSERVED** working pattern).

### One-shot / MCP probes (2026-08-10) — UPDATED (evening unblock)

| Check | Result | Label |
|-------|--------|-------|
| Prior MoA default `poolside/laguna-s-2.1:free` | preset missing; Active MoA off | BLOCKED (resolved by switching provider) |
| Config → custom Ollama Tailscale IP | `hermes status` Custom endpoint | **PASS** |
| Default model | `hermes-fast` (benchmarked; was hermes-agent) | **FACT** — see `docs/HERMES-MODELS.md` |
| Root cause of hangs | systemd `OLLAMA_CONTEXT_LENGTH=65536` + `KEEP_ALIVE=24h`; runaway `n_predict=65536`; bot-server Hermes floods; oneshot raced MCP discovery | **FACT** |
| `hermes -z "Reply with exactly PONG" -m hermes-fast --ignore-rules` | stdout `PONG`, ~15s, exit 0 (after unload + slim toolsets) | **PASS** |
| `hermes mcp test minecraft-qa` | 10 tools, connect ~1.5s | **PASS** |
| Oneshot without `wait_for_mcp_discovery` | model only saw clarify/memory/todo | **OBSERVED** (fixed via local oneshot patch) |
| E2E A observe + rpg_observe | real Steve state reported; gateway log PASS | **PASS** |
| E2E B observe → move_to(+2x) → observe | move args logged; coords changed | **PASS** |
| E2E C quest accept exploratory | `BLOCKED already_active` (3 active quests) — correct | **PASS** (process) |
| Lower Ollama global ctx/keep-alive | needs sudo on `/etc/systemd/system/ollama.service.d/override.conf` | **BLOCKED** (user action) |

---

## 4. Recommended architecture

```text
Cursor (engineer)
    │ builds / tests / deploys harness + Agent Gateway
    ▼
integration-tests (ONLY Minecraft execution path)
    ├── deterministic scenarios (regression)
    └── Agent Gateway (MCP stdio OR thin HTTP)
            ▲
            │ official: hermes mcp add minecraft-qa --command wsl.exe --args …
            │
Hermes Agent (Windows CLI / -z or chat -q)
    └── exploratory goals → only verified capability tools
```

**Preferred bridge:** MCP **client** side of Hermes (`hermes mcp add` with stdio command), tools = verified capability wrappers (`observe`, `move_to`, `break_block`, `rpg_accept`, …).

**Agent Gateway** (under `integration-tests/runner/gateway/`):
- Speaks MCP stdio.
- Internally uses existing `Harness` + `RawKeepAliveActor` + `capabilities.js`.
- Returns structured `{ status: OBSERVED|PASS|FAIL|BLOCKED|UNKNOWN, … }` — never map “command accepted” to PASS.
- Does **not** create a second Minecraft client stack.

**Not recommended now:** fragile hacks (scraping TUI, injecting into `state.db`, pretending `hermes mcp serve` hosts our tools).

---

## 5. What will be implemented now vs later

### Now (this iteration)

1. This recon doc (**done**).
2. **P1 `move_to` / `step`** — **EMPIRICALLY VALIDATED** (scenario `07-move-to`, 5/5).
3. Minimal **Agent Gateway** MCP stdio — **EMPIRICALLY VALIDATED** (`gateway/smoke.js` → `GATEWAY_SMOKE PASS`).
4. Register via `hermes mcp add` — **PASS** (WSL node bridge; see `gateway/hermes-mcp.example.yaml`).
5. Windows Hermes `-z` — **PASS** with local Ollama `hermes-fast` + oneshot MCP wait patch.
6. Role → model mapping (benchmarked) — **done** (`docs/HERMES-MODELS.md`, `gateway/model-policy.yaml`).
7. E2E A/B (+ C exploratory) — **PASS** (evidence `runner/reports/e2e-hermes-2026-08-10.md`).
8. Gateway JSONL observability — **done** (`reports/gateway-tools.jsonl`).

### Later

- sudo fix for Ollama `CONTEXT_LENGTH` / `KEEP_ALIVE` (still **BLOCKED** without password).
- Quest accept when a free quest id exists; quest complete → reward (P2/P3).
- Replaceable `LLMProvider` inside the repo for CI without Hermes (P4).
- AI world / Director / OBS (P5–P7).
- Optional: install Windows Node so MCP can drop the WSL bridge.

---

## 6. Status vocabulary (mandatory)

| Status | Meaning |
|--------|---------|
| OBSERVED | Fact recorded; no pass/fail claim |
| PASS | Assertion met with evidence |
| FAIL | Assertion failed with evidence |
| BLOCKED | Could not execute (auth, offline player, missing tool, Hermes returned tool JSON only, …) |
| UNKNOWN | Not yet probed |

Preserve lesson: `/test rpg accept` → `QuestAcceptResult`, not bare `performCommand`.

---

## 7. Quick commands (Windows)

```powershell
$h = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe"

# Sanity
& $h -z "Reply with exactly PONG" --yolo

# Cheap model override
& $h -z "…" -m hermes-fast --yolo

# MCP
& $h mcp list
& $h mcp test minecraft-qa

# Re-register (if removed) — see hermes-mcp.example.yaml for full env bridge + pipe Y
```

# Hermes Agent — installation recon & integration plan

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

Investigation date: 2026-08-10. No APIs invented — all invocation shapes taken from `hermes --help` / subcommand help / local docs.

---

## 1. What is installed

### Windows (primary for this Cursor host)

| Item | Value | Label |
|------|-------|-------|
| CLI | `C:\Users\Danie\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe` (also on PATH as `hermes`) | FACT |
| Alias | `hermes-agent.exe` same venv | FACT |
| Version | **Hermes Agent v0.19.0 (2026.7.20)** · upstream `920beecf` | FACT (`hermes --version`) |
| Install dir | `C:\Users\Danie\AppData\Local\hermes\hermes-agent` | FACT |
| Install method | git | FACT |
| Home / config | `C:\Users\Danie\AppData\Local\hermes\` (`config.yaml`, `SOUL.md`, sessions, skills) | FACT |
| Python | 3.11.15 | FACT |
| Configured model (status) | `poolside/laguna-s-2.1:free` via **Mixture of Agents**; Nous Portal logged in | OBSERVED (`hermes status`) |
| MCP servers configured | **none** (`hermes mcp list` → empty) | FACT |

### WSL (dansilva)

| Item | Value | Label |
|------|-------|-------|
| CLI | `/home/dansilva/.local/bin/hermes` → venv under `~/.hermes/hermes-agent` | FACT |
| Version | **v0.18.0 (2026.7.1)** (older than Windows) | FACT |
| Home | `/home/dansilva/.hermes/` | FACT |

### Related (not the Minecraft QA host)

| Item | Value | Label |
|------|-------|-------|
| `daniel-hermes-forge` | `C:\Users\Danie\Projects\daniel-hermes-forge` — profile export + `hermes_delegate.py` | FACT |
| Forge delegation | SSH `daniel@bot-server` then `hermes --yolo -m <model> -z '…'` | FACT (`docs/ORCHESTRATION.md`, `scripts/hermes_delegate.py`) |
| bot-server Hermes | Preferred for Ollama models (`hermes-agent`, `hermes-coder`, …) over Tailscale | FACT (user rules / forge docs) |

**Decision for Civs QA:** drive exploration from the **Windows Hermes v0.19.0** on this machine (same host that talks to WSL Paper QA over localhost), unless/until Tailscale routing of RCON from bot-server is proven. Do not assume bot-server can reach `civs-testserver` without a probe.

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

Tool calling: Hermes is described as an “AI assistant with tool-calling capabilities”; built-in toolsets include `terminal`, `file`, `web`, etc. MCP tools appear as `server:tool` (`hermes tools list` help text). **FACT.**

---

## 3. Limitations (do not paper over)

1. **No Minecraft awareness in Hermes itself** — must receive tools/skills that call our harness.
2. **`hermes -z` can emit tool-call JSON instead of a final answer** on some models (documented in forge `ORCHESTRATION.md`) — exploratory runner must treat that as `BLOCKED`/`UNKNOWN`, not PASS.
3. **Windows vs WSL Hermes versions differ** (0.19 vs 0.18) — pin integrations to Windows CLI for this repo’s Cursor sessions.
4. **Nous / MoA auth expires** — oneshot may fail when portal tokens expire (`hermes status` shows access exp).
5. **Do not grant Hermes raw shell to RCON** as the integration — that violates “LLM decides WHAT, harness decides HOW” and reintroduces fake-success (`performCommand` lesson).
6. **bot-server path** is a second Hermes; using it for Minecraft QA requires an extra network probe (UNKNOWN until tested).
7. **One-shot probe on Windows (2026-08-10) — BLOCKED:**
   - `hermes -z "…"` with current config failed: `MoA preset 'poolside/laguna-s-2.1:free' was not found. Available presets: default.`
   - Retry with `--provider openrouter` failed: `No LLM provider configured.`
   - `hermes status` still shows MoA + Nous login, but `hermes moa list` reports **Active in config: (off)** and only preset `default`.
   - **Do not** auto-run `hermes model` / interactive setup from this agent. Integration code must tolerate `BLOCKED` until Daniel fixes the MoA/provider config (or we prove bot-server `-z` + localhost tunnel).

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
            │ official: hermes mcp add minecraft-qa --command node --args …
            │
Hermes Agent (Windows CLI / -z or chat -q)
    └── exploratory goals → only verified capability tools
```

**Preferred bridge:** MCP **client** side of Hermes (`hermes mcp add` with stdio command), tools = verified capability wrappers (`observe`, `move_to`, `break_block`, `rpg_accept`, …).

**Agent Gateway** (new, small, under `integration-tests/runner/`):
- Speaks MCP stdio (or later HTTP if needed).
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
4. Register via `hermes mcp add` — **attempted, BLOCKED** on Windows: no `node.exe` (`WinError 2`). Example registration left in `integration-tests/runner/gateway/hermes-mcp.example.yaml` (not auto-applied to Hermes home).
5. Exploratory Hermes `-z` E2E — **BLOCKED** (MoA/provider config). Task text ready in `gateway/exploratory-task.example.md`.

### Later

- Quest complete → reward deterministic scenario (P2/P3).
- Replaceable `LLMProvider` inside the repo for CI without Hermes (P4).
- AI world / Director / OBS (P5–P7).

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

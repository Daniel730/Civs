# First exploratory task (Hermes → Gateway → Harness)

## Goal (high-level for Hermes)

> Using ONLY the minecraft-* MCP tools, investigate whether RPG quest acceptance
> is consistent: free a max-active slot if needed, attempt accept on a quest that
> should succeed (`rescue_quartermaster` or similar), then observe profile.
> Report status as OBSERVED/PASS/FAIL/BLOCKED/UNKNOWN with evidence.
> Do NOT run arbitrary shell/RCON. Do NOT use performCommand for quest accept.

## Preconditions

1. Paper QA server up (WSL `civs-testserver`), harness 0.2.x deployed.
2. Gateway smoke green: `node gateway/smoke.js` with `RCON_PASSWORD=civsqa`.
3. Hermes MCP registered to `minecraft-qa` (see `hermes-mcp.example.yaml`).
4. Hermes oneshot provider working (`hermes -z` not MoA-broken).

## Invoke (official CLI — only after 3+4)

```powershell
hermes -z "Follow exploratory-task.example.md: use minecraft_rpg_observe, minecraft_rpg_abandon if at max-active, minecraft_rpg_accept for a viable quest, re-observe. Return JSON statuses only." --accept-hooks
```

## Current blockers (2026-08-10)

| Step | Status |
|------|--------|
| Gateway MCP tools | **PASS** (`gateway/smoke.js`) |
| `move_to` capability | **PASS** (scenario 07) |
| Hermes `mcp add` on Windows | **BLOCKED** — no `node.exe` on Windows PATH (WinError 2) |
| Hermes `-z` oneshot | **BLOCKED** — MoA preset missing / no LLM provider configured |
| Full Hermes exploratory E2E | **BLOCKED** until provider + MCP registration |

## When unblocked

Capture Hermes stdout + gateway tool traces → if FAIL suspected, reproduce with a deterministic scenario under `runner/scenarios/`.

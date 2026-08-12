# AI World — Coordination Board (back-and-forth: brain agent ↔ body agent)

This file is the shared handoff channel between the two Hermes agents working the Minecraft
Civs AI World. **Brain agent** owns cognition/memory/learning; **Body agent** owns
locomotion/navigation/anti-stupid/objective-selection. Read the other side, then append your
section. Keep it FACT/measured, not prose.

## Division of labour (agreed)
- **Brain agent** (this writer): `lib/ai-world/ollama-brain.js`, `world-memory.js`, `decision.js`,
  learning loop (`scripts/aiworld-learn-loop.sh`, `aiworld-finetune.py`), `civs-brain` model.
  Status: READY + validated (ad-hoc + node --check; live ollama_decision proven on QA server).
- **Body agent** (you): `lib/village/walk.js`, `lib/ai-world/anti-stupid.js`, `objective-plan.js`,
  `mine-executor.js`, `goals.js`, the per-tick objective/waypoint selector. Owns the Steve that
  the player actually sees.

## What the brain agent already delivered (do not re-do)
- `world-memory.js` now absorbs the FULL observe payload: `deaths`, `last_damage_cause`,
  `last_damage`, `light_level`, `block_below`, plus `nearest_hostile`/blocks. `features()` exposes
  them. (Ad-hoc 7/7, node --check PASS.)
- `OllamaBrain.isAvailable()` fixed: was POSTing to `/api/tags` (Ollama returns 405 → brain
  silently disabled). Now GET → `available=true` → `decide()` consults `civs-brain` live.
- `civs-brain` model exists in Ollama (prompt-only on hermes-agent-mc; LoRA blocked on gemma4).
- Worker `village-worker.js` is STOPPED (tmux `aiworld-civs` killed) so it no longer adds RCON
  noise. It was never the body controller — it only logged `ollama_decision`/`work_tick`.

## Diagnosis for the body agent (from server observation, 2026-08-12)
Symptom reported by user: Steve spawns, walks in a circuit under the platform, tries to climb,
fails, stares at a fence, repeats — since yesterday. RCON also churns inventory/coords.

Findings (FACT, measured on QA server):
- `lib/village/walk.js` already has server-side A* (`walk_path`): measured 3.89 blocks/s, 0%
  stalled samples, 3 RCON cmds, no teleport. **Navigation primitive is NOT the problem.**
- The loop is therefore an **objective/waypoint** problem: the agent keeps selecting a goal it
  cannot reach (under the platform, needs to climb) and re-injects it.
- `lib/ai-world/anti-stupid.js` has `tryRetry(maxRetries=3)` + `invalidatedPlans: Set()`. If the
  plan is NOT added to `invalidatedPlans` after retries exhaust, the same goal is re-selected →
  circuit. **Likely root cause of the "stupid loop".** Check whether `invalidatedPlans` is ever
  populated and whether the objective selector reads it.
- `civs-create` (tmux `civs-qa`) was observed looping: recreating `civs-brain` (4.9GB pull at
  64%) + equipping NPCs via RCON (`Removed N items / Replaced slot [Diamond...]`) in repetition.
  That RCON churn is NOT from village-worker (killed). Confirm with user whether civs-create
  should be running.

## Open questions for the body agent
1. Where is the per-tick objective/waypoint selector? (which file picks "go under platform / climb")
2. Does `anti-stupid` actually invalidate a plan on `retry_budget_exhausted`, or just retries?
3. What coordinates is Steve targeting, and why can't `walk_path` reach them (height/clip)?
4. Is `civs-create` yours, or should it be stopped?

## Handoff protocol
- Append a `## Body agent — <date>` section answering the above + what you changed.
- Brain agent will then wire the validated world-memory signals into the objective selector IF
  you want the brain to bias goal choice (e.g. avoid death_zone). Otherwise brain stays read-only
  on the body.
- Neither agent pushes. Branch: `fix/camera-observation-alex-steve` (local).

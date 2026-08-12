# AI World — Status (honest, measured)

Branch local: `fix/camera-observation-alex-steve` (nothing pushed). Two Hermes agents work
in back-and-forth: **brain agent** (this writer, cognition/memory/learning) and **body agent**
(locomotion/objective-selector — the other agent). Neither pushes.

## What is DONE + verified (brain agent)
| Capability | Evidence | Status |
|---|---|---|
| Brain decides live with world context | WSL: snapshot deaths=131/ENTITY_ATTACK/light=2(DARK) → `focus=survive`; ad-hoc + node --check | ✅ |
| World memory absorbs deaths/damage/light/block | ad-hoc 5/5 on `world-memory.js` | ✅ |
| Anti-oscillation cognition | `decision.js` breaks A↔B via `invalidatePlan` + alt goal; ad-hoc 5/5 | ✅ |
| `threat.js` recognizes `nearest_hostile` | zombie@3 → DANGER/defend not blind heal; ad-hoc | ✅ |
| Offline learning dataset clean | `aiworld-finetune.py` → 230 ex (111 pos/119 neg), 0 "NEGATIVE:" noise, enriched snapshot | ✅ |
| Learning loop CLOSED | decision→reward→experience→dataset proven end-to-end (ad-hoc) | ✅ |
| Brain emits NO waypoints | grep `target.x/target.z/waypoint/move_to` in `decision.js` → 0 matches | ✅ |
| Civs/AI-World split for safe push | `scripts/civs-clean-branch.sh` (regex) untracks 155 AI-World files; mini-repo verified 0 AIW tracked, 3 Civs kept | ✅ |
| Suite green | `npm run test:unit` → 294/294 | ✅ |

## What is the BODY agent's (other agent) job — NOT done
- **The visible Steve circuit**: spawns, walks under the platform, tries to climb, stares at a
  fence, repeats. Root cause = **objective/waypoint selector** picks an unreachable (x,z) and
  re-issues it. The brain CANNOT cause this (emits no coordinates — proven above).
- `lib/village/walk.js` A* is fine (measured 3.89 blocks/s, 0% stalled) — navigation primitive
  is NOT the bug. The bug is *which* (x,z) the selector chooses + not invalidating a stuck one.
- Brain hands the body these ready signals every tick in `assessment.worldMemory`:
  `deaths`, `lastDamageCause`, `lightLevel`, `blockBelow`, `dangerZone`, `nearestHostile`.
  The body's selector should EXCLUDE waypoints in `dangerZone` / high-`deaths` areas (contract in
  `docs/AIWORLD-BRAIN-CONTRACT.md`).

## How to verify the full loop live (when body is fixed)
1. Body agent fixes the waypoint selector (avoid death_zones, invalidate stuck waypoints).
2. Both agents run together: brain `decide()` → body converts intent to a SAFE (x,z) → `walk_path`.
3. Watch Steve on the client: should play with purpose, not loop. No server RCON churn.
4. `ollama_decision` log line + `walk_path` success = proof.

## Known blockers (unchanged)
- **LoRA real training blocked**: `ollama create civs-brain-lora` fails (`400 unknown type`) on
  gemma4. Dataset + Modelfile ready for a llama/mistral base (future).
- **Camera (C) deferred** by user decree — not started.
- **Push**: none. Civs plugin code is unmodified by AI-World work (separate node runtime via RCON).

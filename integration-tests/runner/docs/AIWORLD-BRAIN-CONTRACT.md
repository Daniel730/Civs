# AI World — Brain ↔ Body contract

This pins down what the **brain** (cognition, `lib/ai-world/`) emits and what the
**body** (locomotion/objective-selector, `lib/village/`, `lib/survival/`, `objective-plan.js`)
must consume. Written so the two Hermes agents (and the user) agree on blame for the
visible "Steve walks a stupid circuit" bug.

## What the brain emits (FACT, measured)
The worker (`scripts/village-worker.js`) consumes TWO brain layers and the body must honor
BOTH, in order:

1. **Survival layer** — `SurvivalMonitor.assess(observe)` returns:
   - `state`: SAFE | CAUTION | DANGER | ESCAPE | RECOVER
   - `action.kind`: `flee` | `defend` | `heal` | `retreat` | `work`
   - If `state` ∈ {DANGER, ESCAPE, RECOVER}, the worker runs `executeSurvival(action.kind)`
     **immediately** (survival always wins). The body must execute `flee`/`defend`/`heal`/
     `retreat` with a SAFE target (away from the threat / home), never a fixed waypoint.
   - Measured: `grep` for `target.x|target.z|waypoint|move_to` in `decision.js` and
     `ollama-brain.js` → **0 matches**. The brain decides *what*, the body decides *where*.

2. **Need layer** — when SAFE/CAUTION, `decide()` returns `focus` (survive/found/build/
   maintain/secure) → `chooseObjective()` maps it to a **`job`** the body must run:
   | focus      | job (body must implement) |
   |------------|---------------------------|
   | survive    | guard                     |
   | secure     | guard                     |
   | found      | placeregion               |
   | build      | builder                   |
   | maintain   | farmer                    |
   | (all done) | beautify                  |
   The body executes `job` with a SAFE (x,z) waypoint — see death-zone rule below.

So the brain emits **no coordinates**; it emits `action.kind` (survival) + `job` (need).
The visible "Steve walks a stupid circuit" is a body `job`→waypoint failure, NOT the brain.

## Therefore the circuit is the body's responsibility
The user-visible loop (Steve spawns, walks under the platform, tries to climb, stares at
a fence, repeats) is a **waypoint/objective-selection** failure: the body converts the
brain's `job`/`action.kind` into a concrete `(x,z)` and issues `move_to`/`walk_path`. If
that waypoint is unreachable (under-platform, needs climb, clip) and gets re-selected, you
get the circuit. The brain cannot cause it — it emits no coordinates.

## Signals the brain already computes for the body to avoid death-loops
Every tick `assessment.worldMemory` (from `world-memory.js`) carries:
- `deaths` (count here), `lastDamageCause`, `lastDamage`
- `dangerZone` (bool, set when a death/lethal event happened recently at the current spot)
- `lightLevel`, `blockBelow`, `nearestHostile`

The body's objective/waypoint selector SHOULD:
1. Read `worldMemory.deaths` / `dangerZone` for the candidate waypoint's area.
2. If a candidate waypoint is in a `dangerZone` (or has high `deaths`), **exclude it** and
   pick the next-best goal — never re-select the stuck one (the brain's `decision.js` already
   breaks intent-oscillation via `invalidatePlan`; the body must do the same for waypoints).
3. If `walk_path` stalls (server returns no path / agent wedged), the survival layer already
   recovers via teleport-home (`lib/survival/execute.js` retreat fallback, D-AP-021) — but the
   *objective* must not immediately re-issue the same unreachable waypoint.

## Ownership summary
| Layer | Owns | Status |
|---|---|---|
| Brain (`lib/ai-world/`) | `action.kind` + `job`/focus + anti-oscillation + world-memory signals | DONE + verified |
| Body objective/waypoint selector | concrete (x,z) for each `job`, climb handling, death_zone avoidance | body agent |
| Body locomotion (`walk.js` A*) | path execution | DONE (3.89 b/s measured) |

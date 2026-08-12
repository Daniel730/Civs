# AI World — Brain ↔ Body contract

This pins down what the **brain** (cognition, `lib/ai-world/`) emits and what the
**body** (locomotion/objective-selector, `lib/village/`, `lib/survival/`, `objective-plan.js`)
must consume. Written so the two Hermes agents (and the user) agree on blame for the
visible "Steve walks a stupid circuit" bug.

## What the brain emits (FACT, measured)
`decision.js decide()` returns ONLY an **abstract intent** — never coordinates:
```
{ intent: 'explore'|'build'|'maintain'|'survive'|'secure'|'found'|...,
  goal, reason, model, needScores }
```
Verified: `grep` for `target.x|target.z|waypoint|move_to` in `decision.js` → **0 matches**.
The brain decides *what to do* (survive/build/explore), not *where to go*.

## Therefore the circuit is the body's responsibility
The user-visible loop (Steve spawns, walks under the platform, tries to climb, stares at
a fence, repeats) is a **waypoint/objective-selection** failure: the body converts the
brain's abstract intent into a concrete `(x,z)` and issues `move_to`/`walk_path`. If that
waypoint is unreachable (under-platform, needs climb, clip) and gets re-selected, you get
the circuit. The brain cannot cause it — it emits no coordinates.

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
| Brain (`lib/ai-world/`) | intent/focus + anti-oscillation + world-memory signals | DONE + verified |
| Body objective/waypoint selector | concrete (x,z), climb handling, death_zone avoidance | body agent |
| Body locomotion (`walk.js` A*) | path execution | DONE (3.89 b/s measured) |

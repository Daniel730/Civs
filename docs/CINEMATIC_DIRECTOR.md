# Cinematic Director

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**PARTIAL** — full Director FSM still TODO. A **minimal spectator camera** ships with the NPC village builder (issue #49):

- `integration-tests/runner/lib/camera.js` — second `RawKeepAliveActor` (`Cam`) in spectator mode
- Native follow: `execute as Cam run spectate <builder>` (**PASS** on WSL QA)
- Optional orbit: `FORCE_ORBIT=1` → capability `teleport` + `look_at`
- Watch docs: `docs/NPC-NIGHT-SHIFT.md` (viewer launch + OBS)

## Intent

Independent Director observes world interest, controls a dedicated camera player/bot, produces a feed suitable for OBS livestream capture.

## Dependencies

- P1 camera movement capabilities (smooth look/teleport/orbit) on an online camera player — **partially available** (`look`, `look_at`, `teleport`).
- P5 world agents generating real activity worth filming — village builder is a first producer.
- OBS remains external (capture/encode/stream) — FACT preference from mission; no OBS coupling in-plugin yet.

## Planned states

`IDLE → SEARCHING → ESTABLISHING → FOLLOWING → ACTION → DRAMATIC → OBSERVING → TRANSITIONING → RECOVERING`

Interest scoring and anti-boredom cooldowns: configurable weights; do not hardcode unvalidated numbers into production defaults without measurement.

## Camera modes (target)

follow, over-shoulder, side track, orbit, establishing, wide, close, action, static, aerial, POV — each implemented as deterministic camera controllers, not LLM tick control.

**Now:** `follow` via vanilla spectate + optional orbit tick.

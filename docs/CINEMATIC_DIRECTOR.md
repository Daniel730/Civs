# Cinematic Director

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**TODO** — subsystem not present in repo. Documented so work does not invent a parallel stack later.

## Intent

Independent Director observes world interest, controls a dedicated camera player/bot, produces a feed suitable for OBS livestream capture.

## Dependencies

- P1 camera movement capabilities (smooth look/teleport/orbit) on an online camera player.
- P5 world agents generating real activity worth filming.
- OBS remains external (capture/encode/stream) — FACT preference from mission; no OBS coupling in-plugin yet.

## Planned states

`IDLE → SEARCHING → ESTABLISHING → FOLLOWING → ACTION → DRAMATIC → OBSERVING → TRANSITIONING → RECOVERING`

Interest scoring and anti-boredom cooldowns: configurable weights; do not hardcode unvalidated numbers into production defaults without measurement.

## Camera modes (target)

follow, over-shoulder, side track, orbit, establishing, wide, close, action, static, aerial, POV — each implemented as deterministic camera controllers, not LLM tick control.

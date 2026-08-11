# Cinematic Director

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**PARTIAL** — Issue **#72** ships a deterministic shot director for the village worker.
The named full FSM below remains **TODO**; do not claim livestream “AI cinematography”
beyond what unit tests and harness probes prove.

### Implemented (#72)

| Piece | Path | Evidence |
|-------|------|----------|
| Shot vocabulary + dwell windows | `lib/observation/shots.js` | `npm run test:nightshift-unit` (shot suite) |
| Subject scoring / hysteresis / event priority | `lib/observation/subject-scoring.js` | unit tests (no work-tick forced cuts) |
| Node director (cam_shot + legacy fallback) | `lib/observation/cinematic.js` | unit tests; `CAM_LEGACY=1` → `ObservationDirector` |
| Server `cam_shot` / `cam_status` | `MotionActions.java` | harness `mvn package` SUCCESS; live RCON returns `player_offline` (not `unknown_action`) |
| OTel camera counters | `lib/metrics.js` | unit tests |

### Still TODO / BLOCKED

```text
TODO: Full FSM IDLE→SEARCHING→ESTABLISHING→FOLLOWING→ACTION→DRAMATIC→…
TODO: Live before/after camera switch cadence on a long village-worker run
      (actors were offline during the finish session; capabilities only probed)
PARTIAL: cam_shot occlusion/ease quality is unit-mocked + code-reviewed —
  no new empirical framing probe numbers claimed in this PR
```

## Intent

Independent Director observes world interest, controls a dedicated camera player/bot,
produces a feed suitable for OBS livestream capture.

## Dependencies

- Continuous camera motion on an online camera player — **IMPLEMENTED** as
  `cam_shot` (ease + cut threshold + occlusion counters); legacy `teleport`+`look_at`
  remains the fallback when the harness jar is old.
- World agents generating activity — village-worker (`Steve` / `Alex`) is the first producer.
- OBS remains external — no OBS coupling in-plugin.

## Planned states (target)

`IDLE → SEARCHING → ESTABLISHING → FOLLOWING → ACTION → DRAMATIC → OBSERVING → TRANSITIONING → RECOVERING`

**Now:** `CinematicDirector` selects subject + shot, issues `cam_shot`, holds dwell,
falls back to settlement orbit when every subject is offline. Interest scoring uses
activity, novelty, and event priority — not LLM tick control.

## Camera modes

| Mode | Status |
|------|--------|
| establishing / medium / over-shoulder / orbit / low / profile / top-down / dolly-in / reaction | **IMPLEMENTED** in shot vocabulary (Node + `cam_shot` args) |
| vanilla spectate follow | **IMPLEMENTED** (`camera.js`, ViewerFollowLoop) |
| Full POV / action / static aerial product modes | **TODO** as named FSM states |

## Stream nightshift integration (#51)

- Deterministic **FallbackDirector** + **ShotPlanner**:
  `integration-tests/runner/lib/stream/`
- OBS / music / health: `docs/STREAMING-ARCHITECTURE.md`, `docs/STREAM-NIGHTSHIFT.md`
- Village worker default director is now `CinematicDirector` (issue #72); set
  `CAM_LEGACY=1` for the older `ObservationDirector`.

## Related

- Issue **#72**, D-AP-021
- `docs/AI_WORLD.md`, `docs/CAMERA-OBSERVATION.md`, `docs/NPC-NIGHT-SHIFT.md`

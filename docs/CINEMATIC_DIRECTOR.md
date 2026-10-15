# Cinematic Director

Labels: **FACT** · **OBSERVED** · **INFERRED** · **UNKNOWN** · **TODO**

## Status

**PARTIAL** — Issue **#72** ships a deterministic shot director for the village worker,
now with the full named FSM **IMPLEMENTED** (`lib/observation/director-fsm.js`).
Live validation on an online server remains **TODO**; do not claim livestream
“AI cinematography” beyond what unit tests and harness probes prove.

### Implemented (#72)

| Piece | Path | Evidence |
|-------|------|----------|
| Shot vocabulary + dwell windows | `lib/observation/shots.js` | `npm run test:nightshift-unit` (shot suite) |
| Subject scoring / hysteresis / event priority | `lib/observation/subject-scoring.js` | unit tests (no work-tick forced cuts) |
| Node director (cam_shot + legacy fallback) | `lib/observation/cinematic.js` | unit tests; `CAM_LEGACY=1` → `ObservationDirector` |
| Named FSM IDLE→SEARCHING→ESTABLISHING→FOLLOWING→ACTION→DRAMATIC→OBSERVING→TRANSITIONING→RECOVERING | `lib/observation/director-fsm.js` (integrated into `cinematic.js`) | `test/director-fsm.test.js` — 46 tests in FSM+cinematic suites; nightshift-unit 103/103 pass |
| FSM transition metric + logging | `lib/metrics.js` (`camera_fsm_transition_count`), `director_fsm_transition` log lines | unit tests |
| Server `cam_shot` / `cam_status` | `MotionActions.java` | harness `mvn package` SUCCESS; live RCON returns `player_offline` (not `unknown_action`) |
| OTel camera counters | `lib/metrics.js` | unit tests |

### Still TODO / BLOCKED

```text
TODO: Live before/after camera switch cadence on a long village-worker run
      (actors were offline during the finish session; capabilities only probed)
TODO: Live observation of FSM state flow on an online server (server offline during
      implementation; FSM is unit-tested only)
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

## FSM states (IMPLEMENTED — unit-tested, not yet live-validated)

`IDLE → SEARCHING → ESTABLISHING → FOLLOWING → ACTION → DRAMATIC → OBSERVING → TRANSITIONING → RECOVERING`

FACT: `DirectorFSM` (`lib/observation/director-fsm.js`) makes the existing editorial
behaviour explicit; it does not change shot logic. Mapping:

| State | Backed by |
|-------|-----------|
| IDLE | director constructed / stopped |
| SEARCHING | no current subject; scoring pass pending |
| TRANSITIONING | a cut is being issued (new subject, dwell expired, activity change, event preempt) |
| ESTABLISHING | first shot on a new subject (`isNewSubject`) |
| FOLLOWING | steady coverage of an active subject |
| OBSERVING | steady coverage of an idle subject |
| ACTION | active event priority ≥ 70 (< 90), e.g. `region_placed` |
| DRAMATIC | active event priority ≥ 90, e.g. `death` |
| RECOVERING | camera offline or all subjects offline → fallback settlement orbit |

Every transition increments `camera_fsm_transition_count{from,to,reason}` and emits a
`director_fsm_transition` log line. Out-of-grammar edges are counted + logged DEGRADED
Live validation on an online server remains **TODO** for #72; do not claim livestream “AI cinematography” beyond unit tests and harness probes.
priority — **no LLM in the tick** (D-AP-021).

## Camera modes

| Mode | Status |
|------|--------|
| establishing / medium / over-shoulder / orbit / low / profile / top-down / dolly-in / reaction | **IMPLEMENTED** in shot vocabulary (Node + `cam_shot` args) |
| vanilla spectate follow | **IMPLEMENTED** (`camera.js`, ViewerFollowLoop) |
| ACTION / DRAMATIC / OBSERVING etc. as named FSM states | **IMPLEMENTED** (`director-fsm.js`) |
| Full POV / static aerial product modes | **TODO** |

## Stream nightshift integration (#51)

- Deterministic **FallbackDirector** + **ShotPlanner**:
  `integration-tests/runner/lib/stream/`
- OBS / music / health: `docs/STREAMING-ARCHITECTURE.md`, `docs/STREAM-NIGHTSHIFT.md`
- Village worker default director is now `CinematicDirector` (issue #72); set
  `CAM_LEGACY=1` for the older `ObservationDirector`.

## Related

- Issue **#72**, D-AP-021
- `docs/AI_WORLD.md`, `docs/CAMERA-OBSERVATION.md`, `docs/NPC-NIGHT-SHIFT.md`

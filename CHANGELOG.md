# Changelog

## Unreleased — agent platform P1

### Added
- Platform documentation under `docs/` (`ARCHITECTURE`, `AGENT_PLATFORM`, `QA_AGENTS`, `AI_WORLD`, `CINEMATIC_DIRECTOR`, `TESTING`, `OPERATIONS`) with FACT/UNKNOWN labels.
- Server-side player capabilities in `CivsTestHarness`: `/test act`, `/test observe` (Paper `Player` APIs for teleport/look/sneak/sprint/jump/break/place/attack/hotbar/run_as).
- RPG observation bridge: `/test rpg ping|observe` (reflection into RPGServer `ProfileManager`, no compile dep).
- Runner `lib/capabilities.js` and scenarios `03-player-capabilities.js`, `04-rpg-observe.js`.
- Empirical probe log `integration-tests/CAPABILITY-PROBE-RESULTS.txt`.
- Decisions D-AP-001…005 in `DECISIONS.md`.

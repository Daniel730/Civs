# Changelog

## Unreleased — agent platform P1

### Added
- Platform documentation under `docs/` (`ARCHITECTURE`, `AGENT_PLATFORM`, `QA_AGENTS`, `AI_WORLD`, `CINEMATIC_DIRECTOR`, `TESTING`, `OPERATIONS`) with FACT/UNKNOWN labels.
- Server-side player capabilities in `CivsTestHarness`: `/test act`, `/test observe` (Paper `Player` APIs for teleport/look/sneak/sprint/jump/break/place/attack/hotbar/run_as).
- RPG observation bridge: `/test rpg ping|observe` (reflection into RPGServer `ProfileManager`, no compile dep).
- Runner `lib/capabilities.js` and scenarios `03-player-capabilities.js`, `04-rpg-observe.js`.
- Empirical probe log `integration-tests/CAPABILITY-PROBE-RESULTS.txt`.
- Death/respawn/reconnect scenario (`05-death-respawn-reconnect.js`) + `game_mode`/`die`/`respawn` capabilities.
- RPG quest accept/abandon via `/test rpg accept|abandon` + scenario `06-rpg-quest-accept.js`.
- Greedy `move_to`/`step` (no Mineflayer) + scenario `07-move-to.js`.
- Agent Gateway MCP stdio (`runner/gateway/`) + Hermes recon (`docs/HERMES-INTEGRATION.md`).
- Decisions D-AP-001…009 in `DECISIONS.md`.

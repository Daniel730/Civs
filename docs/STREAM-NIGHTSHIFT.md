# STREAM NIGHTSHIFT

Labels: **FACT** · **OBSERVED** · **BLOCKED** · **UNKNOWN** · **INFERRED**

Date: 2026-08-11. Branch: `feat/stream-nightshift-51`. Issue: [#51](https://github.com/Daniel730/Civs/issues/51). Related: [#49](https://github.com/Daniel730/Civs/issues/49) / PR [#50](https://github.com/Daniel730/Civs/pull/50).

Architecture: `docs/STREAMING-ARCHITECTURE.md`. Agent stack unchanged (Hermes → MCP → Gateway → harness). No Mineflayer. No public YouTube start. No credentials committed.

---

## STREAM NIGHTSHIFT — status board

| Area | Status | Evidence |
|------|--------|----------|
| Minecraft | **READY** | WSL tmux `civs-qa` UP; RCON/game ports listening (**OBSERVED**) |
| AI NPC | **READY** | Steve/Cam in `latest.log`; village builder path from #49 (**OBSERVED**) |
| Director (full FSM) | **BLOCKED** | Still TODO in `CINEMATIC_DIRECTOR.md` |
| Director fallback | **READY** | `lib/stream/fallback-director.js` + unit-tested planner |
| Camera | **READY** | `camera.js` + `applyPose`; RCON recover → `Now spectating Steve` (**PASS**) |
| OBS | **READY** | OBS 32.1.0 installed; profile **CivsNightshift** 1080p30 NVENC 4500 (**FACT**) |
| Scenes | **READY** | 8 scenes in collection stub; bind Game Capture once in UI (**OBSERVED** on disk) |
| Audio layers | **DEGRADED** | Assets + OBS sources wired; ear mix not fully listening-validated |
| Music license | **LICENSE-VERIFIED** | Original procedural WAV + allowlist + metadata checksums |
| Music playback | **READY** | Playlist + Media Source path in scene collection; OBS already running |
| Overlays | **READY** | `stream-assets/overlays/cinematic.html` |
| Fallback cinematic | **READY** | ShotPlanner anti-repetition + FallbackDirector |
| Health | **READY** | `health-check.ps1` → `reports/stream/health.json` |
| Local stream test | **READY** | `start-stream-test.ps1` (record only; never `--startstreaming`) |
| YouTube config | **READY** | `stream-assets/youtube/TEMPLATES.md` |
| YouTube credentials | **NOT CONFIGURED** | By design |
| Public livestream | **NOT STARTED** | By design |

Overall local prep: **READY for private capture**; public go-live **BLOCKED** on Daniel’s YouTube auth.

---

## Prepared

- Issue [#51](https://github.com/Daniel730/Civs/issues/51)
- Docs: `STREAMING-ARCHITECTURE.md`, this file; pointers in `CINEMATIC_DIRECTOR.md`
- `stream-assets/` (music, ambience, overlays, OBS templates, YouTube templates, licenses)
- Runner: `lib/stream/{shot-planner,fallback-director,health}.js`, `camera.applyPose`
- Scripts: `install-obs-profile`, `start-stream-test`, `health-check`, `recover-{obs,music,camera}`
- Unit tests: `test/stream-planner.test.js` — **7/7 PASS** (WSL Node 25.8.0)

## Validated

| Check | Result |
|-------|--------|
| Shot planner unit tests | **PASS** |
| OBS profile install | **PASS** (`%APPDATA%\obs-studio\basic\profiles\CivsNightshift`) |
| Scene collection 8 scenes | **PASS** (Starting Soon … Stream Ending) |
| Camera RCON spectate recover | **PASS** (`Now spectating Steve`) |
| Music playlist rewrite | **PASS** |
| Health JSON write | **PASS** (overall **BLOCKED** only because `stream` component is intentionally blocked for YouTube) |
| Public livestream | **NOT STARTED** |

## Music

- Allowlist: `stream-assets/licenses/ALLOWLIST.md`
- Tracks: original procedural PCM only (no third-party, no “no copyright” dumps)
- Playback: OBS Media Source → `soft-loop-procedural.wav` (loop); optional ambience pad
- Volumes (starting suggestion): music ≈ −18 dB, ambience ≈ −24 dB vs game — refine by ear

## OBS

- Existing install reused (no duplicate install)
- Profile **CivsNightshift**: 1920×1080, **30 FPS**, NVENC, **4500** kbps, reconnect on
- Collection **CivsNightshift**: interstitial color/text + shared Minecraft Capture / Overlay / Music
- Local test: `integration-tests/runner/scripts/stream/start-stream-test.ps1`
- Manual once: select Minecraft window on **Minecraft Capture** if empty

## Camera

- Modes via planner: follow, orbit, wide, exploration, overhead, poi, event, idle
- Integrates with existing `SpectatorCamera` (`Cam`); no second harness
- Anti-repetition: history, cooldowns, min/max duration, event priority

## Director

- Full AI Director: **BLOCKED / TODO**
- Deterministic fallback: **READY** (does not fake intelligence)

## Fallback

- `FallbackDirector` drives Cam when Director unavailable
- Idle/default target pad `5200,80,5200` if observe fails

## Health

States: `HEALTHY | DEGRADED | FAILED | RECOVERING | BLOCKED`  
Components: minecraft, obs, camera, director, npc, music, audio, network, stream

```powershell
powershell -ExecutionPolicy Bypass -File integration-tests/runner/scripts/stream/health-check.ps1
```

## YouTube

- Templates only — **no auth, no keys**
- Credentials: **NOT CONFIGURED**
- Public livestream: **NOT STARTED**

## Manual actions (Daniel)

1. In OBS: switch to profile/collection **CivsNightshift**; bind Minecraft capture; confirm music audible.
2. Optional ear pass on music/ambience vs game levels.
3. When ready for public: set YouTube RTMP key **only in OBS UI** (never commit).
4. Viewer client: continue using `launch-viewer.ps1` / `/spectate Cam` (other agent may be fixing auto-join).
5. Optional: install FFmpeg CLI later for offline encode tools (OBS already has bundled libs) — **not required**.

## PRs / Issues

| Item | Link |
|------|------|
| Issue | [#51](https://github.com/Daniel730/Civs/issues/51) |
| Depends on cinematic Cam | [#49](https://github.com/Daniel730/Civs/issues/49) / [#50](https://github.com/Daniel730/Civs/pull/50) |
| This branch | `feat/stream-nightshift-51` |

## Recovery cheat-sheet

| Subsystem | Script |
|-----------|--------|
| OBS | `recover-obs.ps1` |
| Music playlist | `recover-music.ps1` |
| Camera spectate | `recover-camera.ps1` |
| Paper / NPC | existing tmux `civs-qa` / `village-npc` (`docs/NPC-NIGHT-SHIFT.md`) |

# Streaming architecture (Civs / Agent Platform)

Labels: **FACT** · **OBSERVED** · **INFERRED** · **BLOCKED** · **UNKNOWN** · **TODO**

Date: 2026-08-11. Issue: [#51](https://github.com/Daniel730/Civs/issues/51). Related: [#49](https://github.com/Daniel730/Civs/issues/49) / PR [#50](https://github.com/Daniel730/Civs/pull/50).

## Goal

Private, recoverable capture pipeline for a **future** 24/7 YouTube livestream of the Civs AI world. Public broadcast and credentials are **out of scope** until Daniel configures them manually.

## Real components (do not invent)

```text
┌─────────────────────────────────────────────────────────────────┐
│ Windows host (RTX 3060, dual 1080p)                              │
│  OBS Studio 32.1.0  ── Window/Game Capture ──► local record/RTMP │
│  Media Source: stream-assets music/ambience                      │
│  Browser Source: stream-assets/overlays/*.html                   │
│  Optional Viewer client (Minecraft 26.1.2 offline)               │
└──────────────▲──────────────────────────────────────────────────┘
               │ spectate Cam / Window Capture
┌──────────────┴──────────────────────────────────────────────────┐
│ WSL Paper QA  (/home/dansilva/civs-testserver)                   │
│  Paper 26.1.2 :25565  RCON :25575  tmux civs-qa                  │
│  Plugins: Civs + CivsTestHarness + Vault + economy + WorldEdit   │
└──────────────▲──────────────────────────────────────────────────┘
               │ RCON + protocol actors
┌──────────────┴──────────────────────────────────────────────────┐
│ Agent Platform (existing — no second harness)                    │
│  Hermes → MCP → Agent Gateway → integration-tests/runner         │
│  RawKeepAliveActor Steve (builder) + Cam (SpectatorCamera)       │
│  camera.js · village-builder.js · village-watch.js               │
│  stream/* (shot planner, fallback director, health)              │
└─────────────────────────────────────────────────────────────────┘
```

## What exists today

| Piece | Path / location | Label |
|-------|-----------------|-------|
| Spectator Cam | `integration-tests/runner/lib/camera.js` | **FACT** (PR #50) |
| OBS install | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` v32.1.0 | **FACT** |
| OBS helper | `integration-tests/runner/scripts/start-obs-capture.ps1` | **FACT** |
| Viewer launch | `integration-tests/runner/scripts/launch-viewer.ps1` | **FACT** (viewer may be WIP elsewhere) |
| Director FSM | `docs/CINEMATIC_DIRECTOR.md` | **PARTIAL / TODO** |
| Night-shift ops | `docs/NPC-NIGHT-SHIFT.md` | **FACT** |
| Paper QA | WSL tmux `civs-qa`, ports 25565/25575 | **OBSERVED** |
| NVENC | OBS SimpleOutput StreamEncoder=nvenc | **OBSERVED** |
| FFmpeg CLI (Windows/WSL) | not installed | **OBSERVED** — OBS uses bundled libs; CLI optional |
| Node on Windows PATH | missing | **OBSERVED** — runner Node via WSL nvm v25.8.0 |
| YouTube credentials | none in repo | **FACT** — must stay that way |

## Non-goals

- Mineflayer or a second actor harness.
- Fake “AI Director” intelligence — use deterministic shot planner + optional real Director later.
- Committing stream keys, OAuth tokens, or paid-service secrets.
- Starting a public YouTube livestream from automation.

## OBS profile (repo templates → local AppData)

Repo templates live under `stream-assets/obs/`. Install script copies them into `%APPDATA%\obs-studio\` as profile **CivsNightshift** and scene collection **CivsNightshift** without touching YouTube service settings.

Recommended encode (24/7 stability, not max quality):

| Setting | Value | Why |
|---------|-------|-----|
| Base / output | 1920×1080 | Match primary display |
| FPS | 30 | Lower GPU/thermals than 60 |
| Encoder | NVENC H.264 | RTX 3060 present |
| Bitrate | 4500 kbps CBR | Stable for long sessions |
| Audio | AAC 160 kbps, 48 kHz | Match OBS default sample rate |
| Reconnect | on, delay 2s, max 25 | Already in default OBS profile |
| Stream test | **Custom / file or null** — never attach live YouTube key in automation | Local only |

## Camera modes (interfaces)

Implemented as deterministic controllers on top of `SpectatorCamera` (same Cam player):

| Mode | Mechanism | Status |
|------|-----------|--------|
| follow | vanilla `spectate <target>` | **READY** (camera.js) |
| orbit | teleport + look_at | **READY** (`FORCE_ORBIT=1` / planner) |
| wide / overhead / idle | teleport offsets + look_at | **READY** (fallback planner) |
| POI / event | teleport to coords + look_at | **READY** (planner API; needs POI feed) |
| tracking | soft re-spectate | **READY** (`ensureFollow`) |
| Full Director scoring | FSM in CINEMATIC_DIRECTOR | **BLOCKED / TODO** |

Anti-repetition: shot history + cooldowns in `integration-tests/runner/lib/stream/shot-planner.js`.

## Audio layers

1. **Minecraft** — Desktop/Window audio from viewer or server (no mic required).
2. **Music** — OBS Media Source playlist → `stream-assets/music/` (allowlist only).
3. **Ambience** — optional second Media Source → `stream-assets/ambience/`.
4. Volumes: start music ~−18 dB, ambience ~−24 dB relative to game; refine by ear (`docs/STREAM-NIGHTSHIFT.md`).

## Health model

Components: `minecraft`, `obs`, `camera`, `director`, `npc`, `music`, `audio`, `network`, `stream`.

States: `HEALTHY` | `DEGRADED` | `FAILED` | `RECOVERING` | `BLOCKED`.

Script: `integration-tests/runner/scripts/stream/health-check.ps1` → JSON under `reports/stream/`.

## Recovery (isolated)

Each restart script targets **one** subsystem. Never restart Paper + OBS + music in one blast unless explicitly requested.

| Script | Target |
|--------|--------|
| `recover-obs.ps1` | OBS process only (local record / stream-test) |
| `recover-music.ps1` | Notes for OBS media source; optional playlist rewrite |
| `recover-camera.ps1` | Re-run camera ensureFollow via WSL runner helper |
| Existing tmux | `civs-qa` / `village-npc` — see NPC-NIGHT-SHIFT |

## Local stream test mode

`start-stream-test.ps1` launches OBS with **CivsNightshift** profile and **starts recording only** (or idle). It does **not** pass `--startstreaming` and does **not** configure a YouTube service.

## YouTube (config only)

Templates in `stream-assets/youtube/` — title/description/tags/category/ops notes. Credentials: **NOT CONFIGURED**. Public livestream: **NOT STARTED**.

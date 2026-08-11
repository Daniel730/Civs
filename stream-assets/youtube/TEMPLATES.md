# YouTube listing templates (NO credentials)

Do **not** put stream keys, OAuth tokens, or cookies here.

## Title templates

- `Civs AI Village — Night Build {date}`
- `Civs 24/7 — Watch the Agents Build (Quiet Cam)`
- `NpcPad Construction — Cinematic Spectator`

## Description template

```text
Unattended Civs agents founding and expanding a village on a private Paper QA world.
Cinematic spectator camera (Cam) · Agent Platform harness · no Mineflayer.

What you're watching:
- Deterministic village builder + optional fallback cinematic shots
- Soft original procedural music (see stream-assets/licenses)

Not affiliated with Mojang / Microsoft beyond Minecraft as a platform.

Software: Civs plugin + Paper 26.1.2
Music attribution: {track list from metadata/*.json}
```

## Tags

`minecraft, civs, paper, ai agents, city builder, chill, cinematic, 24/7, sandbox`

## Category

Gaming

## Thumbnail concept

- Quiet wide shot of village pad at golden hour (or overhead)
- Small “LIVE · Civs” wordmark corner — no clutter, no fake chat overlays
- Avoid copyrighted art / other creators’ thumbnails

## Ops / reconnect notes

1. OBS profile **CivsNightshift**, collection **CivsNightshift**
2. Local validate with `start-stream-test.ps1` (record only)
3. When Daniel is ready: configure YouTube RTMP **manually** in OBS UI (never commit key)
4. Reconnect: OBS Output Reconnect=true, RetryDelay=2, MaxRetries=25
5. If encoder fails: drop to 3600 kbps / 30 FPS before changing scenes
6. Health: `health-check.ps1` → reports/stream/health.json

## Status

| Item | State |
|------|-------|
| Templates | **READY** |
| Credentials | **NOT CONFIGURED** |
| Public livestream | **NOT STARTED** |

# OBS CivsNightshift — scene setup

Labels: **FACT** · **TODO**

Profile settings ship in `profiles/CivsNightshift/basic.ini` (1080p30, NVENC ~4500 kbps, reconnect on).

Scene **collection** JSON is machine-specific (window handles, WASAPI devices). Automation installs the profile and creates an empty collection stub; finish sources once in the OBS UI.

## Required scenes

| Scene | Purpose | Sources |
|-------|---------|---------|
| Starting Soon | Idle before watchable feed | Color (dark) + Text “Starting Soon” + optional Music |
| Minecraft — Cinematic | Default watch | Game/Window Capture + Overlay browser + Music |
| Minecraft — Wide | Establishing | Same capture (camera mode changes in-game) |
| Minecraft — Exploration | Roaming | Same |
| Minecraft — Event | Highlight | Same + Event text via overlay query |
| Minecraft — AFK Quiet | Low activity | Same + lower music |
| BRB | Break | Color + Text “Be right back” |
| Stream Ending | Soft outro | Color + Text “Thanks for watching” |

Camera mode switching is **in-game** (Cam / FallbackDirector), not separate GPU captures — scenes mainly change overlays/music emphasis.

## One-time UI steps (after `install-obs-profile.ps1`)

1. Open OBS → profile **CivsNightshift**, collection **CivsNightshift**.
2. Add scenes listed above.
3. Add **Game Capture** or **Window Capture** → Minecraft 26.1.2 / `javaw`.
4. Add **Browser** source → `stream-assets/overlays/cinematic.html` (local file), 1920×1080, transparent.
5. Add **Media Source** → `stream-assets/music/soft-loop-procedural.wav`, loop, restart on activate; volume ≈ −18 dB.
6. Optional second Media Source → `ambience/soft-pad-procedural.wav` ≈ −24 dB.
7. Mute mic unless talking; desktop audio = Minecraft.
8. Transitions: Fade 400–700 ms.
9. **Do not** set a YouTube stream key for automation tests.

## Validation

`start-stream-test.ps1` must launch OBS with this profile and must **not** pass `--startstreaming`.

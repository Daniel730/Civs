# Civs QA automation

Python QA harness for the WSL Paper test server (`localhost:25565`) and a Minecraft client on Windows (Smokeshow).

## Architecture

| Layer | Tool | Examples |
|------|------|----------|
| Server console | **RCON** (`rcon_client.py`) | `list`, `tp`, inventory dump, `gamemode` |
| Player chat / keys | **Window bot** (`window_bot.py`) | Esc, `//wand`, hotbar `1`–`9`, **F2** |
| Vision | **F2 + `vision.py`** | `%APPDATA%\.minecraft\screenshots\` → `reports/screenshots/` |
| GUI clicks | **Window bot slots** | Shop / towns / RPG hub |

**Important:** Chat commands fail while an inventory or Civs/RPG **menu is open**. The bot presses **Esc once**, clicks Back to Game if pause opened, then **T**. A second Esc after closing a menu opens the pause screen and chat fails silently. Menus must be tested with **clicks** (`run_all.py menus`).

**Vision:** Prefer Minecraft **F2** screenshots (exact client render). Do not rely primarily on pyautogui window capture.
## Prerequisites

1. WSL test server running (`scripts/_tmux_server.sh start` inside WSL).
2. Minecraft client connected to `localhost:25565` (offline), logged in as Smokeshow.
3. Python 3.10+ on Windows.
4. Match `window_bot.gui_scale` to client GUI Scale (`options.txt` → `guiScale`).

## Setup

```powershell
cd C:\Users\Danie\Downloads\Civs-1.11.6\Civs-1.11.6\scripts\qa
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements-qa.txt
copy config.example.yaml config.yaml
```

Create `.env`:

```env
RCON_PASSWORD=civsqa
```

### Enable RCON on WSL server

```powershell
python run_all.py smoke --enable-rcon
```

Then **restart** the Paper server.

## Run commands

```powershell
python run_all.py smoke
python run_all.py features              # Esc before each chat command
python run_all.py features --skip-window
python run_all.py menus                 # GUI click-through
python run_all.py structures
python run_all.py all --window --window-cmd "//wand"
```

Reports land in `scripts/qa/reports/` (`features_*`, `menus_*`, `structures_*`, `run_all_*`).

## Menu click calibration

Chest GUIs are assumed **centered** in the Minecraft window. Slot index → screen XY uses vanilla 18×18 slot spacing × `gui_scale`.

| Config key | Role |
|------------|------|
| `gui_scale` | Must match Video Settings → GUI Scale (1–4) |
| `gui_offset_x` / `gui_offset_y` | Pixel nudge if clicks miss |
| `esc_before_chat` / `esc_retries` | Close menus before T |

Civs main menu (`menus/main.yml`, size 27): shop=13, blueprints=12, towns=10, …  
RPG hub (54): Civs tab=2, Magias=21 → Civs `class`, Combate=25 → `class-list`.

## Structure items (no `/cv give`)

1. RCON `cv advancetut Smokeshow`
2. Shop via `/cv menu` + GUI clicks (see `menus` suite)
3. WorldEdit via window bot after Esc

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Chat does nothing after `/cv menu` | Menu still open, or pause menu open — bot uses Esc + Back to Game click |
| Chat does nothing after two Esc | Second Esc opened pause — enable `dismiss_pause_click` |
| Clicks miss icons | Set `gui_scale` from `options.txt`; nudge `gui_offset_*` |
| RCON auth failed | `smoke --enable-rcon`, restart server, check `.env` |
| Window not found | Match `player.window_title` substring (e.g. `Minecraft`) |

## Cloud / VM

Local WSL + Windows client is the supported path. Cursor Cloud / headless llvmpipe is optional future work (see `HANDOFF.md`) — cloud agents do not inherit the focused Smokeshow window.

## Related

- `HANDOFF.md` — autonomy vs Daniel, Esc lesson, placement progress
- `scripts/_tmux_server.sh` — start/stop/wait-boot

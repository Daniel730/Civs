# Hotbar discipline proof — 2026-07-17

## Verdict: PASS

Daniel live feedback (breaking blocks / wrong chest / no wand) addressed in harness before further structure runs.

## What was wrong

1. **Left-click on viewport** from `focus_minecraft`, pause dismiss, and `right_click(safe_capture=True)` punched blocks while a chest/fist was selected.
2. **Hotbar snapshot skipped slots without `custom_data`** — WE wooden axe in slot 8 was invisible to classification.
3. Staging Civs items could **clear the wand** from other hotbar slots.
4. No hard **abort** when `SelectedItem` did not match the intended action.

## Fixes

| Fix | Where |
|-----|--------|
| Classify hotbar: `wand` / `civs` / `junk` | `inventory.py` |
| Slot layout: Civs=`0`, wand=`8` | `inventory.py` |
| `log_selected` + `select_hotbar_expect` (abort if wrong) | `inventory.py` |
| `ensure_wand` via `//wand` + verify axe | `inventory.py` |
| `release_mouse`; focus without LMB; right-click only | `window_bot.py` |
| WE selects wand before each `//pos`/`//set` | `test_structures.py` |
| `pause_dismiss_method: esc` | `config.yaml` |

## Proof log (excerpt)

```text
[HOTBAR:select_wand_after] slot=8 id=minecraft:wooden_axe kind=wand
[HOTBAR:civs:shelter_after] slot=0 id=minecraft:chest kind=civs civs=shelter
wand_still 8 minecraft:wooden_axe
[HOTBAR:we_switch_after] slot=8 id=minecraft:wooden_axe kind=wand
[HOTBAR:civs:shelter_after] slot=0 id=minecraft:chest kind=civs civs=shelter
ABORT [should_abort]: got kind=civs … (expected kind=wand)
PASS hotbar discipline
```

## Place smoke (after hotbar)

- Hand verified `civs=shelter`, rotation `[0.0f, 35.16f]` (explicit yaw/pitch).
- Right-click fired; **no chest at center yet** — Y-aim/client place still open; **not** a hotbar regression.

## Next

Re-run structure batch only after a place smoke lands chest at `cy` (floor-top aim).

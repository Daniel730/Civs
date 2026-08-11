# QA bugs — 2026-07-17 place / structures / I/O

## Proven PASS

| Item | Report |
|------|--------|
| Hotbar / mouse / place smoke | earlier reports |
| Separated pads + town reuse QATown2 | `structures_20260717_142420.md` |
| **arrow_trap activate** (redstone dust on ground @cy) | `151159` / `152242` / `155133` |
| **potato_farm activate** (farmland + planted potatoes @cy) | `151159` / `152242` / `155133` |
| **14/14 fast activate** (prior packing batch) | `structures_fast_20260717_152242` — **54.1s** |
| **19/20 expanded activate + 7/7 short I/O** | `structures_fast_20260717_155133` — **16.3s** |
| **All short-period I/O PASS** (gravel/dirt/clay/ice/dye/flint/concrete) | `155133` |
| SoftHook w/o AuraSkills | `features_20260717_155134` |

## Harness fixes (QA scripts only)

1. Cactus spaced + sand pedestals; no sand WE dominant fill
2. Aim-pit excluded from build-req packing
3. Farmland under potatoes/wheat; stone under redstone_wire; restamp fragile mats
4. **Crops + redstone + gravity bulk pack on pad surface (cy)** — never buried at footprint floor (`build_reqs.py`)
5. Prep+place **one structure at a time** (burst-all-prep wiped neighbors)
6. Town: reuse QATown*; gated SKIP if in-town ring full (no outside fallback)
7. Satellite origin for ungated types (away from hub clutter)
8. Fast I/O: period>20s → SKIP; poll ≤12s @0.25s; pad gap 0.05s
9. **I/O detection via `execute if items`** — RCON `data get` truncates multi-slot chest NBT (false FAIL)
10. **Single `data merge` stock** + stock before WSL YAML scan (RegionTick lastTick=0 race)
11. **OR-group outputs expanded** (dye/concrete/dirt probabilistic lines)
12. Clear player inventory before each `cv give` (quarry group max:12)
13. PAD_MARGIN 10→12 (cactus/coal exact-margin overlap)

## Remaining FAIL / SKIP (doc only)

| Item | Status | Notes |
|------|--------|-------|
| cactus_farm activate | intermittent FAIL | Exact pad margin vs coal; margin bumped — recheck next run |
| catapult activate | SKIP from batch | `war-enabled: true` — replaced by altar |
| coal/purifier/cobble/potato/shelter/housing I/O | SKIP | period > FAST_MAX_PERIOD_S (20) |
| arrow_trap / smithy / command_tent I/O | SKIP/— | no item outputs or power-only |
| altar / redstone_mine I/O | SKIP | period 3600s |
| Town ring exhaustion | SKIP alloc | Prune regions near hub between dense runs |
| Quarry group max:12 | harness hygiene | Clear inventory + wipe satellite regions between dense runs |

## Coverage checklist

See `reports/coverage_matrix.md`.

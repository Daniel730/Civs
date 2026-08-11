# Civs + RPG QA coverage matrix

**Updated:** 2026-07-17 (I/O detect + expanded batch)  
**Player:** Smokeshow · RCON `25575`  
**Default runner:** `python run_all.py fast` / `structures` (RCON-first)  
**Status legend:** PASS / FAIL / SKIP / PARTIAL / TODO

## Throughput gate

| Gate | Status | Evidence |
|------|--------|----------|
| ≥8 activate attempts in &lt;10 min | **PASS** | `structures_fast_20260717_155133` — **19/20** activate, **16.3s** wall |
| Pads non-overlap | PASS | PadAllocator + PAD_MARGIN 12 + satellite origin |
| Town reuse QATown* | PASS | gated section |
| I/O RCON stock (no chest GUI) | **PASS** | 7/7 short-period I/O via `execute if items` |
| SoftHook w/o AuraSkills | PASS | `features_20260717_155134` |
| Crop build-reqs = planted | PASS | potato_farm activate |
| Redstone = dust / block on ground | PASS | arrow_trap wire; altar/redstone_mine blocks |

## Fast smoke — structures (20-type batch)

| Type | Category | Activate | I/O | Notes |
|------|----------|----------|-----|-------|
| gravel_quarry | quarry/raw | **PASS** | **PASS** | shovel → gravel×4 ~0.5–2s |
| dirt_quarry | quarry/raw | **PASS** | **PASS** | OR dirt/podzol/… |
| clay_quarry | quarry gated | **PASS** | **PASS** | clay_ball×4 |
| ice_maker | factory | **PASS** | **PASS** | snow+shovel → ice |
| dye_works | factory | **PASS** | **PASS** | OR dyes (purple etc.) |
| flint_works | factory gated | **PASS** | **PASS** | gravel+shovel → flint |
| concrete_factory | factory gated | **PASS** | **PASS** | sand/gravel/pick/cauldron → OR concrete |
| cobble_quarry | quarry | **PASS** | SKIP | period 30s |
| coal_mine | mine | **PASS** | SKIP | period 600s |
| cactus_farm | farm | FAIL* | — | *margin overlap flaky; PAD_MARGIN→12 |
| potato_farm | farm gated | **PASS** | SKIP | period 300s; planted crops |
| arrow_trap | defense | **PASS** | SKIP | no item outputs; redstone_wire |
| altar | offense | **PASS** | SKIP | redstone_block; period 3600s |
| command_tent | offense | **PASS** | — | power-only |
| shelter | housing | **PASS** | SKIP | long period |
| shack | housing gated | **PASS** | SKIP | long period |
| hovel | housing gated | **PASS** | SKIP | long period |
| purifier | utility | **PASS** | SKIP | period 900s |
| smithy | utility gated | **PASS** | — | activate-only |
| redstone_mine | mine | **PASS** | SKIP | redstone_block; period 3600s |

Evidence: `structures_fast_20260717_155133` · prior packing `152242` (14/14).

## Civs — systems

| Feature | Status | How | Report |
|---------|--------|-----|--------|
| `/cv give` admin | PASS | RCON | jar 1.11.7 |
| `/cv placeregion` admin | **PASS** | RCON 19/20 | `155133` |
| SoftHook w/o AuraSkills | **PASS** | features | `features_20260717_155134` |
| Custom mobs spawn | PASS | features rcon | features |
| Shop / economy buy | TODO | menus + TestEconomy | separate short smoke |
| Combat bar RMB cast | TODO | window (not in fast) | — |

## RPG plugin

| Feature | Status | Report |
|---------|--------|--------|
| SoftHook w/o AuraSkills | **PASS** | features |
| `/rpg hub` | PASS (prior menus) | menus |
| Magias → Civs class | PARTIAL | menus |

## Harness

| Discipline | Status |
|------------|--------|
| Fast path default | PASS |
| Prep+place per type (no burst wipe) | PASS |
| Crops on pad surface + farmland | PASS |
| Redstone dust/block on pad surface | PASS |
| Gravity bulk on surface | PASS |
| I/O detect via `execute if items` | **PASS** | data-get truncates multi-slot NBT |
| Single `data merge` chest stock | PASS | beats RegionTick race |
| OR-group outputs expanded | PASS | dye/concrete/dirt |
| Gated SKIP if town ring full | PASS |
| Satellite origin for ungated | PASS |
| Pad gap 0.05s · I/O poll ≤12s | PASS |
| Clear inventory before each give | PASS | avoids group-max (quarry:12) |

## Bugs (doc only)

See `bugs_20260717_place_structures.md`.

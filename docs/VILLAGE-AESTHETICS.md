# Village aesthetic rules (NpcPad workers)

Status: mandatory for `village-worker` / `village-builder` changes.  
Issues: #64, Refs #66 (natural terrain / no platforms).  
See also: [`docs/CONSTRUCTION-QUALITY.md`](CONSTRUCTION-QUALITY.md).

## What “beautiful” means here

Paper harness bots are not architects. Within `/test act` + RCON `setblock` we still require:

1. **Plan before place** — use `lib/village/blueprints.js` templates compiled into the construction IR (`lib/village/construction/`). No freehand random blocks.
2. **Validate before place** — site + blueprint + foundation + palette gates; never skip (`runProject`).
3. **Grid alignment** — integer block coords; coherent footprints (floor → walls with door/window gaps → slab roof).
4. **Material palettes** — oak housing, stone military/smithy, dirt_path connectors (`PALETTES` / style system).
5. **Civs first** — prefer `cv placeregion` + honest stockpiles over decoration; never break inn↔barracks exclusivity.
6. **Pride / cleanup** — `beautify` job removes historic junk scatter (`site+6` cobble/stone-brick spam) and restores `grass_block`.
7. **Walk, don’t teleport** — `lib/village/walk.js` stepped gait; teleport only as rare recovery (`too_far` / stuck).
8. **Transactions** — every aesthetic block change is logged; failed inspection → repair or rollback.

## Forbidden

- Random `place_block` towers or `tick % 3` scatter pads
- Hard `tp` every work tick as the default approach
- Placing junk inside Civs region footprints meant for build-reqs
- Large flatten platforms / `fill` pads as the default village prep (`VILLAGE_ALLOW_PAD_FLATTEN=1` is unsafe opt-in only)
- Floating normal buildings (`NORMAL_BUILDING_FLOATING_BLOCKS = 0` unless `blueprint.elevated`)

## Honesty limit

`place_block` cannot do true steep roofs / complex architecture. We use slab roofs + fence rings + paths. That is still a large step up from scatter spam. The construction engine remains authoritative for world safety even if a future vision critic suggests style tweaks.

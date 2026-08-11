# Village aesthetic rules (NpcPad workers)

Status: mandatory for `village-worker` / `village-builder` changes.  
Issue: #64

## What “beautiful” means here

Paper harness bots are not architects. Within `/test act` + RCON `setblock` we still require:

1. **Plan before place** — use `lib/village/blueprints.js` templates (house shell, path, farm edge). No freehand random blocks.
2. **Grid alignment** — integer block coords; coherent footprints (floor → walls with door/window gaps → slab roof).
3. **Material palettes** — oak housing, stone military/smithy, dirt_path connectors (`PALETTES` in blueprints).
4. **Civs first** — prefer `cv placeregion` + honest stockpiles over decoration; never break inn↔barracks exclusivity.
5. **Pride / cleanup** — `beautify` job removes historic junk scatter (`site+6` cobble/stone-brick spam) and restores `grass_block`.
6. **Walk, don’t teleport** — `lib/village/walk.js` stepped gait; teleport only as rare recovery (`too_far` / stuck).

## Forbidden

- Random `place_block` towers or `tick % 3` scatter pads
- Hard `tp` every work tick as the default approach
- Placing junk inside Civs region footprints meant for build-reqs

## Honesty limit

`place_block` cannot do true steep roofs / complex architecture. We use slab roofs + fence rings + paths. That is still a large step up from scatter spam.

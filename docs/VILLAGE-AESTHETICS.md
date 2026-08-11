# Village aesthetic rules (NpcPad workers)

Status: mandatory for `village-worker` / `village-builder` changes.  
Issues: #64 (beauty/walk), **#66 (player-like / no platforms / no cheats)**.  
See also: [`docs/CONSTRUCTION-QUALITY.md`](CONSTRUCTION-QUALITY.md).

## Player-like policy (critical)

Bots must look and act like **survival players** on **existing natural terrain**.

1. **No platforms** — do not flatten large pads, float houses on plank floors, or scatter decorative platforms that wreck the world.
2. **No cheats as default** — no creative-mode work ticks, no spawn-then-break mining, no hard `tp` every job, no decorative `fill` terraforming.
3. **Use the land** — `findSurfaceY` (RCON `execute if block`) adapts stands/blueprints to ground height; walk with `walk_step`.
4. **Place like a player** — blocks on solid ground / adjacent to existing structures; small footprints (3×3 cabin walls+roof, **no floor pad**); paths replace surface only.
5. **Beautify cleans** — tear historic junk + former house-shell platforms; restore `grass_block`. Never build more pads in beautify.
6. **Civs first** — prefer existing town/region footprints and rare `cv placeregion` over inventing mega-builds.
7. **Validate before place** — construction pipeline site + blueprint + foundation + palette gates via `runProject`; never skip.
8. **Transactions** — aesthetic block changes are logged; failed inspection → repair or rollback.

## Allowed admin shortcuts (minimize)

| Shortcut | When allowed | Why |
|----------|--------------|-----|
| Stockpile `fill`/`setblock` | Immediately before `cv placeregion` / `ensureTown` only | Civs build-reqs need in-world block counts |
| `gamemode creative` | Founding tick only, then back to survival | Needed to place dense stockpile quickly |
| Soft teleport | `walkTo` recovery (`too_far` / stuck) only | Not normal movement |
| `setblock` fallback | Slabs/paths/fences when `place_block` fails | Capability honesty limit |

Standalone **stockpile work ticks** (fill without placing a region) are **forbidden** — they were the main world-wrecker.

## What “beautiful” still means

1. **Plan before place** — `lib/village/blueprints.js` templates compiled into construction IR (`lib/village/construction/`).
2. **Grid alignment** — integer coords; coherent small footprints.
3. **Material palettes** — oak housing, cobble accents, `dirt_path` connectors (`PALETTES` / style system).
4. **Walk, don’t teleport** — `lib/village/walk.js`; teleport only as rare recovery.
5. **Pride / cleanup** — `beautify` job removes platform scars and restores grass.

## Forbidden

- Floor platforms / 5×5 plank pads under decorative shells
- Random `place_block` towers or scatter pads
- Hard `tp` every work tick
- Creative gamemode for miner/builder/farmer/patrol/beautify
- Spawning stone/log with `setblock` then `break_block`
- Placing junk inside Civs region footprints meant for build-reqs
- Inventing Paper APIs or Mineflayer clients
- Large flatten platforms / `fill` pads as the default village prep (`VILLAGE_ALLOW_PAD_FLATTEN=1` is unsafe opt-in only)
- Floating normal buildings (`NORMAL_BUILDING_FLOATING_BLOCKS = 0` unless `blueprint.elevated`)

## Honesty limit

`place_block` cannot do true steep roofs / complex architecture. We use small cabin walls + slab roof + paths. That is intentional understatement — better than terraforming platforms. The construction engine remains authoritative for world safety even if a future vision critic suggests style tweaks.

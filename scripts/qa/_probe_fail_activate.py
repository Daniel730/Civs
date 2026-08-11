"""One-shot probe: retry FAIL activate types on fresh pads; print place output."""
from __future__ import annotations

import time

from build_reqs import load_item_groups, parse_build_reqs, plan_block_placements
from item_types import load_batch
from qa_config import load_config
from rcon_client import RconClient
from test_structures import PadAllocator, parse_region_centers_wsl, find_reuseable_qa_town
from test_structures_fast import rcon_fill_build_reqs, _rcon_ok

NAMES = ["purifier", "ice_maker", "dye_works", "smithy", "arrow_trap", "shack", "potato_farm", "cobble_quarry"]


def main() -> None:
    cfg = load_config()
    groups = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")
    items, missing = load_batch(cfg.item_types_dir, NAMES)
    print("missing", missing)
    existing = parse_region_centers_wsl()
    reused = find_reuseable_qa_town()
    ox, oy, oz = 5200, 81, 5200
    hub = None
    if reused:
        hx, hy, hz = reused["hub"]
        hub = (hx, hz)
        print("town", reused["town_name"], "hub", reused["hub"])
    allocator = PadAllocator(ox, oy, oz, cols=3, existing=existing)
    if hub:
        allocator.reserve_blocked(hub[0], hub[1], 12, "town_hub")

    with RconClient(cfg.rcon) as client:
        player = cfg.player_name
        _rcon_ok(client, f"op {player}")
        _rcon_ok(client, f"gamemode creative {player}")
        _rcon_ok(client, "clear @p")
        for item in items:
            r = int(item.build_radius or 3)
            need_town = item.requires_inside_town or item.requires_town_membership
            try:
                if need_town and hub:
                    pad = allocator.allocate_inside_town(item.key, radius=r, hub_cx=hub[0], hub_cz=hub[1])
                elif hub:
                    pad = allocator.allocate_outside_town(item.key, radius=r, hub_cx=hub[0], hub_cz=hub[1])
                else:
                    pad = allocator.allocate(item.key, radius=r)
            except RuntimeError as exc:
                print(f"{item.key}: ALLOC FAIL {exc}")
                pad = allocator.allocate(item.key, radius=r)
            cx, cy, cz = pad.cx, pad.cy, pad.cz
            reqs = parse_build_reqs(item.build_reqs, groups)
            placements = plan_block_placements(cx, cy, cz, r, reqs)
            build = rcon_fill_build_reqs(client, cx, cy, cz, r, placements)
            _rcon_ok(client, f"tp {player} {cx + 0.5} {cy + 2} {cz + 0.5}")
            give = _rcon_ok(client, f"cv give {player} {item.key} 1")
            place = _rcon_ok(client, f"cv placeregion {player} {item.key} {cx} {cy} {cz}")
            ok = "placeregion OK" in (place or "")
            print(
                f"{item.key}: act={ok} center=[{cx},{cy},{cz}] zone={'town' if need_town else 'outer'} "
                f"placements={len(placements)} setblocks={build.get('setblocks')} "
                f"place={place!r} give={give[:80]!r}"
            )
            if ok:
                allocator.reserve_blocked(cx, cz, r, f"ok:{item.key}")
            time.sleep(0.05)


if __name__ == "__main__":
    main()

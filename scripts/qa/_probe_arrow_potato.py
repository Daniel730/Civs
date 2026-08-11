"""Probe arrow_trap + potato_farm build-req vs placeregion on fresh in-town pads."""
from __future__ import annotations

import time

from build_reqs import load_item_groups, parse_build_reqs, plan_block_placements
from item_types import load_batch
from qa_config import load_config
from rcon_client import RconClient
from test_structures import PadAllocator, parse_region_centers_wsl, find_reuseable_qa_town
from test_structures_fast import rcon_fill_build_reqs, _rcon_ok

NAMES = ["arrow_trap", "potato_farm", "concrete_factory"]


def main() -> None:
    cfg = load_config()
    groups = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")
    items, _ = load_batch(cfg.item_types_dir, NAMES)
    existing = parse_region_centers_wsl()
    reused = find_reuseable_qa_town()
    assert reused, "need QATown"
    hx, hy, hz = reused["hub"]
    print("hub", reused["hub"], "blocked", len(existing))
    allocator = PadAllocator(hx, hy, hz, cols=3, existing=existing)
    allocator.reserve_blocked(hx, hz, 12, "town_hub")

    with RconClient(cfg.rcon) as client:
        player = cfg.player_name
        _rcon_ok(client, f"clear {player}")
        for item in items:
            r = int(item.build_radius or 3)
            try:
                pad = allocator.allocate_inside_town(item.key, radius=r, hub_cx=hx, hub_cz=hz)
            except RuntimeError as exc:
                print(f"{item.key}: ALLOC {exc}")
                continue
            cx, cy, cz = pad.cx, pad.cy, pad.cz
            reqs = parse_build_reqs(item.build_reqs, groups)
            placements = plan_block_placements(cx, cy, cz, r, reqs)
            build = rcon_fill_build_reqs(client, cx, cy, cz, r, placements)
            # Sample blocks actually present
            samples = []
            for x, y, z, mat in placements[:12]:
                blob = _rcon_ok(client, f"data get block {x} {y} {z}")
                samples.append(f"{mat}@{x},{y},{z}=>{blob[:60]}")
            _rcon_ok(client, f"tp {player} {cx+0.5} {cy+2} {cz+0.5}")
            give = _rcon_ok(client, f"cv give {player} {item.key} 1")
            place = _rcon_ok(client, f"cv placeregion {player} {item.key} {cx} {cy} {cz}")
            print(f"\n=== {item.key} @ {cx},{cy},{cz} r={r} placements={len(placements)} set={build} ===")
            print("place:", place)
            print("give:", give[:80])
            for s in samples:
                print(" ", s)
            if "OK" in (place or ""):
                allocator.reserve_blocked(cx, cz, r, f"ok:{item.key}")
            time.sleep(0.05)


if __name__ == "__main__":
    main()

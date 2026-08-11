"""Diagnose satellite activate FAIL: ice_maker + gravel with block verify."""
from __future__ import annotations

from build_reqs import load_item_groups, parse_build_reqs, plan_block_placements
from item_types import load_batch
from qa_config import load_config
from rcon_client import RconClient
from test_structures_fast import rcon_fill_build_reqs, _rcon_ok


def main() -> None:
    cfg = load_config()
    g = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")
    with RconClient(cfg.rcon) as client:
        player = cfg.player_name
        _rcon_ok(client, f"clear {player}")
        for name, cx in (("ice_maker", 5000), ("gravel_quarry", 5050), ("purifier", 5100)):
            it = load_batch(cfg.item_types_dir, [name])[0][0]
            cy, cz = 81, 5000
            r = int(it.build_radius or 3)
            pl = plan_block_placements(cx, cy, cz, r, parse_build_reqs(it.build_reqs, g))
            build = rcon_fill_build_reqs(client, cx, cy, cz, r, pl)
            # verify a few blocks
            checks = []
            for x, y, z, m in pl[:5]:
                # replace detect
                out = _rcon_ok(
                    client,
                    f"execute if block {x} {y} {z} minecraft:{m.split('[')[0]} run say HAS_{m}",
                )
                checks.append((m, x, y, z, out[:40]))
            _rcon_ok(client, f"tp {player} {cx + 0.5} {cy + 2} {cz + 0.5}")
            give = _rcon_ok(client, f"cv give {player} {name} 1")
            place = _rcon_ok(client, f"cv placeregion {player} {name} {cx} {cy} {cz}")
            print(f"\n{name} @{cx} build={build} give={give[:50]!r}")
            print(f"  place={place!r}")
            for ch in checks:
                print(f"  check {ch}")


if __name__ == "__main__":
    main()

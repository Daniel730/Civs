"""Probe RCON item detection that survives NBT truncation."""
from __future__ import annotations

import time

from qa_config import load_config
from rcon_client import RconClient


def main() -> None:
    cfg = load_config()
    with RconClient(cfg.rcon) as c:
        x, y, z = 2975, 81, 2625
        cmds = [
            f"execute if items block {x} {y} {z} container.* minecraft:flint",
            f"execute if items block {x} {y} {z} * minecraft:flint",
            f'data get block {x} {y} {z} Items[{{id:"minecraft:flint"}}]',
        ]
        for cmd in cmds:
            print("CMD", cmd)
            print("OUT", (c.command(cmd) or "")[:240])

        # Restock dye and wait
        dx, dy, dz = 4281, 81, 4018
        for s, mat in enumerate(
            ["ink_sac", "poppy", "cornflower", "bone_meal", "dandelion"]
        ):
            c.command(
                f"item replace block {dx} {dy} {dz} container.{s} with minecraft:{mat} 16"
            )
        c.command(f"tp Smokeshow {dx}.5 {dy + 1} {dz}.5")
        time.sleep(12)
        print("dye blob", (c.command(f"data get block {dx} {dy} {dz} Items") or "")[:300])
        for dye in [
            "red_dye",
            "black_dye",
            "yellow_dye",
            "white_dye",
            "blue_dye",
            "green_dye",
        ]:
            out = c.command(
                f"execute if items block {dx} {dy} {dz} container.* minecraft:{dye}"
            )
            print(dye, out)

        # gravel
        gx, gy, gz = 4208, 81, 4000
        c.command(
            f"item replace block {gx} {gy} {gz} container.0 with minecraft:stone_shovel 1"
        )
        for s in range(1, 9):
            c.command(f"item replace block {gx} {gy} {gz} container.{s} with air")
        c.command(f"tp Smokeshow {gx}.5 {gy + 1} {gz}.5")
        time.sleep(16)
        print(
            "gravel if",
            c.command(
                f"execute if items block {gx} {gy} {gz} container.* minecraft:gravel"
            ),
        )
        print("gravel blob", (c.command(f"data get block {gx} {gy} {gz} Items") or "")[:300])


if __name__ == "__main__":
    main()

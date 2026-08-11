"""Dump full chest + force wait past period for gravel/ice/flint."""
from __future__ import annotations

import time

from qa_config import load_config
from rcon_client import RconClient


def stock_replace(c, x, y, z, items: list[tuple[str, int]]) -> None:
    for s in range(9):
        c.command(f"item replace block {x} {y} {z} container.{s} with air")
    for i, (mat, qty) in enumerate(items):
        c.command(
            f"item replace block {x} {y} {z} container.{i} with minecraft:{mat} {qty}"
        )


def wait_for(c, x, y, z, needle: str, seconds: float = 25.0) -> str:
    t0 = time.time()
    blob = ""
    while time.time() - t0 < seconds:
        blob = c.command(f"data get block {x} {y} {z} Items") or ""
        if needle in blob.lower():
            return f"GAIN {(time.time() - t0):.1f}s {blob[:300]}"
        time.sleep(0.5)
    return f"NO {(time.time() - t0):.1f}s {blob}"


def main() -> None:
    cfg = load_config()
    p = cfg.player_name
    with RconClient(cfg.rcon) as c:
        c.command(f"clear {p}")
        # gravel
        gx, gy, gz = 4208, 81, 4000
        stock_replace(c, gx, gy, gz, [("stone_shovel", 1)])
        c.command(f"tp {p} {gx}.5 {gy + 1} {gz}.5")
        print("gravel start", (c.command(f"data get block {gx} {gy} {gz} Items") or "")[:200])
        print("gravel", wait_for(c, gx, gy, gz, "minecraft:gravel", 25))

        # ice
        ix, iy, iz = 4259, 81, 4016
        stock_replace(c, ix, iy, iz, [("stone_shovel", 1), ("snow_block", 64)])
        c.command(f"tp {p} {ix}.5 {iy + 1} {iz}.5")
        print("ice start", (c.command(f"data get block {ix} {iy} {iz} Items") or "")[:200])
        print("ice", wait_for(c, ix, iy, iz, "minecraft:ice", 25))

        # dye
        dx, dy, dz = 4281, 81, 4018
        stock_replace(
            c,
            dx,
            dy,
            dz,
            [
                ("ink_sac", 16),
                ("poppy", 16),
                ("cornflower", 16),
                ("bone_meal", 16),
                ("dandelion", 16),
            ],
        )
        c.command(f"tp {p} {dx}.5 {dy + 1} {dz}.5")
        print("dye start", (c.command(f"data get block {dx} {dy} {dz} Items") or "")[:200])
        print("dye", wait_for(c, dx, dy, dz, "_dye", 25))

        # flint control
        fx, fy, fz = 2975, 81, 2625
        stock_replace(c, fx, fy, fz, [("gravel", 64), ("stone_shovel", 1)])
        c.command(f"tp {p} {fx}.5 {fy + 1} {fz}.5")
        print("flint", wait_for(c, fx, fy, fz, "minecraft:flint", 20))


if __name__ == "__main__":
    main()

"""Debug overhead place at coal_mine center after carving air shaft."""
from __future__ import annotations

import time

from inventory import CIVS_SLOT, prepare_hotbar_for_placement, select_hotbar_key_and_verify
from qa_config import load_config
from rcon_client import RconClient
from test_structures import _rcon_block_is, _scan_chest_offsets
from window_bot import WindowBot

CX, CY, CZ = 2108, 81, 2108


def main() -> None:
    c = load_config()
    player = c.player_name
    bot = WindowBot(c.window_bot)
    with RconClient(c.rcon) as r:
        r.command(f"gamemode creative {player}")
        # Simulate post-build: solid cube then carve shaft
        r.command(f"fill {CX - 4} {CY - 4} {CZ - 4} {CX + 4} {CY + 4} {CZ + 4} oak_planks")
        r.command(f"fill {CX - 1} {CY} {CZ - 1} {CX + 1} {CY + 4} {CZ + 1} air")
        r.command(f"setblock {CX} {CY - 1} {CZ} stone")
        r.command(f"setblock {CX} {CY} {CZ} air")
        print("air center?", _rcon_block_is(r, CX, CY, CZ, "air"))
        print("stone under?", _rcon_block_is(r, CX, CY - 1, CZ, "stone"))
        print("air above?", _rcon_block_is(r, CX, CY + 2, CZ, "air"))

        h = prepare_hotbar_for_placement(r, player, "coal_mine", preferred_slot=CIVS_SLOT, bot=bot)
        print("hygiene", h.get("ok"), h.get("error"))
        r.command(f"effect give {player} levitation 15 255 true")
        r.command(f"tp {player} {CX + 0.5} {CY + 2.2} {CZ + 0.5} 0 90")
        time.sleep(0.5)
        bot.press_escape(1)
        time.sleep(0.25)
        bot.press_escape(1)
        time.sleep(0.25)
        select_hotbar_key_and_verify(bot, r, player, "coal_mine", CIVS_SLOT)
        r.command(f"tp {player} {CX + 0.5} {CY + 2.2} {CZ + 0.5} 0 90")
        time.sleep(0.35)
        print("rot", r.command(f"data get entity {player} Rotation"))
        print("pos", r.command(f"data get entity {player} Pos"))
        bot.release_mouse()
        rc = bot.right_click(safe_capture=False)
        print("rc", rc)
        time.sleep(1.0)
        exact = _rcon_block_is(r, CX, CY, CZ, "chest")
        scan = _scan_chest_offsets(r, CX, CY, CZ)
        print("exact", exact, "scan", scan)
        # Also scan oak / any block entity
        for dy in range(0, 3):
            for dz in range(-2, 3):
                for dx in range(-2, 3):
                    if _rcon_block_is(r, CX + dx, CY + dy, CZ + dz, "chest"):
                        print(f"CHEST {CX+dx},{CY+dy},{CZ+dz}")
        r.command(f"effect clear {player} levitation")


if __name__ == "__main__":
    main()

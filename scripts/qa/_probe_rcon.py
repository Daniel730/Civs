"""Verify RCON block probes and whether client place works at all."""
from __future__ import annotations

import time

from qa_config import load_config
from rcon_client import RconClient
from window_bot import WindowBot

CX, CY, CZ = 2130, 81, 2108


def main() -> None:
    c = load_config()
    player = c.player_name
    bot = WindowBot(c.window_bot)

    with RconClient(c.rcon) as r:
        cmds = [
            f"setblock {CX} {CY - 1} {CZ} stone",
            f"setblock {CX} {CY} {CZ} air",
            f"execute if block {CX} {CY - 1} {CZ} stone",
            f"execute if block {CX} {CY} {CZ} air",
            f"execute unless block {CX} {CY} {CZ} air",
            f"execute if block {CX} {CY - 1} {CZ} stone run say STONE_OK",
            f"data get block {CX} {CY - 1} {CZ}",
            f"data get block {CX} {CY} {CZ}",
        ]
        for cmd in cmds:
            out = r.command(cmd)
            print(f"CMD: {cmd}")
            print(f" -> {out!r}")
            print()

        # Place dirt VIA RCON to prove detection
        r.command(f"setblock {CX} {CY} {CZ} dirt")
        print("after setblock dirt:")
        print(" data", repr(r.command(f"data get block {CX} {CY} {CZ}")))
        print(" if", repr(r.command(f"execute if block {CX} {CY} {CZ} dirt")))
        print(" say", repr(r.command(f"execute if block {CX} {CY} {CZ} dirt run say DIRT_HIT")))
        r.command(f"setblock {CX} {CY} {CZ} air")

        # Chat test: can bot open chat and run /setblock? No - use give + place
        # First: does SelectedItem count decrease on right-click in creative? Creative doesn't.
        # Use survival briefly to detect place via item count? Too invasive.

        # Alternative: use /particle or check TargettedBlock if available
        print("TargetedBlock?", repr(r.command(f"data get entity {player} ")[:80]))

        # Prep and try place, then use clone/test-for style
        r.command(f"fill {CX - 1} {CY - 1} {CZ - 3} {CX + 1} {CY + 2} {CZ + 1} air")
        r.command(f"fill {CX - 1} {CY - 1} {CZ - 3} {CX + 1} {CY - 1} {CZ + 1} stone")
        r.command(f"setblock {CX} {CY - 1} {CZ - 1} air")
        r.command(f"setblock {CX} {CY - 2} {CZ - 1} stone")
        r.command(f"gamemode creative {player}")
        r.command(f"item replace entity {player} hotbar.0 with minecraft:dirt 64")
        r.command(f"tp {player} {CX + 0.5} {CY} {CZ - 1.5} 0 45")
        time.sleep(0.4)

    bot.focus_minecraft(click_to_focus=False)
    time.sleep(0.3)
    bot.select_hotbar(0)
    time.sleep(0.2)

    # Try pyautogui right click at center AND without move
    win = bot._find_window()
    print("win", win.left if win else None, win.top if win else None, win.width if win else None)

    import pydirectinput as pdi
    import pyautogui

    # Hold right for longer (place hold)
    print("long right hold 0.25s")
    pdi.mouseDown(button="right")
    time.sleep(0.25)
    pdi.mouseUp(button="right")
    time.sleep(0.8)

    with RconClient(c.rcon) as r:
        print("scan via data get:")
        for dx in range(-2, 3):
            for dy in range(-1, 3):
                for dz in range(-3, 3):
                    blob = r.command(f"data get block {CX + dx} {CY + dy} {CZ + dz}")
                    low = blob.lower()
                    if "dirt" in low or "chest" in low or "has the following" in low and "air" not in low and "empty" not in low:
                        # data get on air often errors
                        if "error" in low or "does not exist" in low or "not found" in low:
                            continue
                        if "dirt" in low or "chest" in low or "stone" in low:
                            print(f"  {CX+dx},{CY+dy},{CZ+dz}: {blob[:100]}")


if __name__ == "__main__":
    main()

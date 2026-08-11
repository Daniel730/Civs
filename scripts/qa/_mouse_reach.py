"""Prove mouse reaches Minecraft AFTER Esc ungrab → sky-LMB re-grab.

Critical borderless failure mode: Esc releases mouse; RMB becomes a no-op until
re-grab. This script must dig + place only after an Esc-close cycle.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

import pydirectinput as pdi

from qa_config import load_config
from rcon_client import RconClient
from window_bot import WindowBot

CX, CY, CZ = 2140, 81, 2140


def passed(out: str) -> bool:
    return "Test passed" in (out or "")


def main() -> None:
    c = load_config()
    player = c.player_name
    bot = WindowBot(c.window_bot)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report: list[str] = [f"# Mouse reach after Esc — {stamp}", ""]

    with RconClient(c.rcon) as r:
        print("list", r.command("list"))
        r.command(f"gamemode creative {player}")
        print("fill", r.command(f"fill {CX - 2} {CY - 1} {CZ - 3} {CX + 2} {CY + 2} {CZ + 2} air"))
        print("floor", r.command(f"fill {CX - 2} {CY - 1} {CZ - 3} {CX + 2} {CY - 1} {CZ + 2} stone"))
        print("target dirt", r.command(f"setblock {CX} {CY} {CZ} dirt"))
        r.command(f"item replace entity {player} hotbar.0 with minecraft:dirt 64")
        r.command(f"item replace entity {player} hotbar.1 with minecraft:dirt 64")
        # Stand south, look at dirt (will dig after grab)
        r.command(f"tp {player} {CX + 0.5} {CY} {CZ - 2.0} 0 20")
        time.sleep(0.4)

    assert bot.focus_minecraft(click_to_focus=False)
    bot.select_hotbar(0)
    time.sleep(0.15)

    # --- CRITICAL: Esc ungrabs on borderless ---
    print("--- Esc (ungrab) then sky-LMB re-grab ---")
    bot.press_escape(1)
    time.sleep(0.35)
    # If Esc opened pause, Esc again to close it (also leaves mouse free)
    bot.press_escape(1)
    time.sleep(0.25)

    with RconClient(c.rcon) as r:
        grab = bot.ensure_mouse_grabbed(r, player, restore_yaw=0.0, restore_pitch=20.0)
        print("grab", grab)
        report.append(f"- grab: `{grab}`")
        r.command(f"tp {player} {CX + 0.5} {CY} {CZ - 2.0} 0 20")
        time.sleep(0.35)
        r.command(f"setblock {CX} {CY} {CZ} dirt")

    bot.select_hotbar(0)
    time.sleep(0.1)

    # DIG TEST after Esc+grab
    print("--- DIG TEST LMB (after Esc+grab) ---")
    bot.release_mouse()
    pdi.click(button="left")
    time.sleep(0.55)

    dug = False
    with RconClient(c.rcon) as r:
        still = passed(r.command(f"execute if block {CX} {CY} {CZ} dirt"))
        air = passed(r.command(f"execute if block {CX} {CY} {CZ} air"))
        dug = (not still) or air
        print("after LMB dirt still?", still, "air?", air, "DUG?", dug)
        report.append(f"- dig_after_esc_grab: dug=`{dug}` still_dirt=`{still}` air=`{air}`")

        # PLACE TEST: clear center, aim at stone under center TOP
        r.command(f"setblock {CX} {CY} {CZ} air")
        r.command(f"setblock {CX} {CY - 1} {CZ} stone")
        r.command(f"tp {player} {CX + 0.5} {CY} {CZ - 1.8} 0 40")
        time.sleep(0.35)

    # Second Esc cycle before place (matches place-smoke / menu-close path)
    print("--- Esc again then re-grab before place ---")
    bot.press_escape(1)
    time.sleep(0.25)
    bot.press_escape(1)
    time.sleep(0.2)
    with RconClient(c.rcon) as r:
        grab2 = bot.ensure_mouse_grabbed(r, player, restore_yaw=0.0, restore_pitch=40.0)
        print("grab2", grab2)
        report.append(f"- grab_before_place: `{grab2}`")
        r.command(f"tp {player} {CX + 0.5} {CY} {CZ - 1.8} 0 40")
        time.sleep(0.3)

    bot.select_hotbar(0)
    time.sleep(0.1)
    bot.release_mouse()
    pdi.mouseDown(button="right")
    time.sleep(0.1)
    pdi.mouseUp(button="right")
    time.sleep(0.6)

    placed = False
    with RconClient(c.rcon) as r:
        for dx in range(-2, 3):
            for dy in range(0, 3):
                for dz in range(-2, 3):
                    if passed(r.command(f"execute if block {CX + dx} {CY + dy} {CZ + dz} dirt")):
                        placed = True
                        print("PLACE hit", CX + dx, CY + dy, CZ + dz)
                        r.command(f"setblock {CX + dx} {CY + dy} {CZ + dz} air")
                        break
                if placed:
                    break
            if placed:
                break
        print("PLACE after Esc+grab?", placed)
        report.append(f"- place_after_esc_grab: `{placed}`")

    verdict = "PASS" if (dug and placed) else "FAIL"
    report.insert(2, f"## Verdict: **{verdict}**")
    report.append("")
    report.append("Requires: dig AND place both succeed after Esc → sky-LMB re-grab.")
    path = Path(f"reports/mouse_reach_after_esc_{stamp}.md")
    path.write_text("\n".join(report) + "\n", encoding="utf-8")
    print("VERDICT", verdict, path)
    if verdict != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

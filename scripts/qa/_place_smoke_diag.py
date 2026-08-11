"""One-off place-smoke diagnostics. Do not import from suite."""
from __future__ import annotations

import math
import time
from pathlib import Path

import pydirectinput as pdi
import pyautogui

from inventory import log_selected, select_hotbar_expect
from qa_config import load_config
from rcon_client import RconClient
from vision import assert_world_view, capture_and_classify
from window_bot import WindowBot

CX, CY, CZ = 2130, 81, 2108


def yaw_pitch(px: float, py: float, pz: float, lx: float, ly: float, lz: float) -> tuple[float, float]:
    ex, ey, ez = px, py + 1.62, pz
    dx, dy, dz = lx - ex, ly - ey, lz - ez
    dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    yaw = math.degrees(math.atan2(-dx, dz))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, -dy / dist))))
    return yaw, pitch


def probe(r: RconClient, x: int, y: int, z: int, block: str) -> bool:
    out = r.command(f"execute if block {x} {y} {z} {block} run tellraw @a \"QA_{block}_{x}_{y}_{z}\"")
    return f"QA_{block}_{x}_{y}_{z}" in out or f"QA_{block}" in out


def find_block(r: RconClient, block: str) -> list[tuple[int, int, int]]:
    hits: list[tuple[int, int, int]] = []
    for dx in range(-3, 4):
        for dy in range(-2, 4):
            for dz in range(-4, 4):
                if probe(r, CX + dx, CY + dy, CZ + dz, block):
                    hits.append((CX + dx, CY + dy, CZ + dz))
    return hits


def prep_pad(r: RconClient, player: str) -> None:
    r.command(f"gamemode creative {player}")
    r.command(f"fill {CX - 2} {CY - 2} {CZ - 4} {CX + 2} {CY + 3} {CZ + 2} air")
    r.command(f"fill {CX - 2} {CY - 1} {CZ - 4} {CX + 2} {CY - 1} {CZ + 2} stone")
    # south corridor: no solid at cy-1 between stand and center
    r.command(f"setblock {CX} {CY - 1} {CZ - 1} air")
    r.command(f"setblock {CX} {CY - 2} {CZ - 1} stone")
    r.command(f"setblock {CX} {CY - 1} {CZ} stone")
    r.command(f"setblock {CX} {CY} {CZ} air")
    r.command("time set day")


def main() -> None:
    c = load_config()
    player = c.player_name
    bot = WindowBot(c.window_bot)
    bot.config.pause_dismiss_method = "esc"
    shot = Path("reports/screenshots")
    shot.mkdir(parents=True, exist_ok=True)

    with RconClient(c.rcon) as r:
        print("online", r.command("list"))
        prep_pad(r, player)
        print("stone under center?", probe(r, CX, CY - 1, CZ, "stone"))
        print("air at center?", probe(r, CX, CY, CZ, "air"))

        # Stage plain dirt
        r.command(f"item replace entity {player} hotbar.0 with minecraft:dirt 64")
        for i in range(1, 8):
            r.command(f"item replace entity {player} hotbar.{i} with air")

        px, py, pz = CX + 0.5, float(CY), CZ - 1.5
        # Look into stone block center → hit TOP face from south+above
        lx, ly, lz = CX + 0.5, CY - 0.5, CZ + 0.5
        yaw, pitch = yaw_pitch(px, py, pz, lx, ly, lz)
        print(f"pose feet=({px},{py},{pz}) look=({lx},{ly},{lz}) yaw={yaw:.2f} pitch={pitch:.2f}")
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.5)
        print("rot", r.command(f"data get entity {player} Rotation"))
        print("pos", r.command(f"data get entity {player} Pos"))

        bot.abort_if_pause_trap()
        bot.release_mouse()
        ks = select_hotbar_expect(bot, r, player, slot=0, expect_kind="junk", label="dirt")
        print("hotbar", ks.get("ok"), ks.get("item_id"), ks.get("error"))
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.35)
        vis = assert_world_view(bot, shot, "diag_pre")
        print("vision", vis.get("kind"), "safe", vis.get("safe"), vis.get("path"))

        methods = []

        # M1: pdi right-click no coordinates (grabbed mouse)
        print("--- M1 pdi.click right no xy ---")
        bot.focus_minecraft(click_to_focus=False)
        time.sleep(0.2)
        bot.release_mouse()
        pdi.click(button="right")
        time.sleep(0.7)
        hits = find_block(r, "dirt")
        print("M1 dirt hits", hits)
        methods.append(("M1", hits))
        for x, y, z in hits:
            r.command(f"setblock {x} {y} {z} air")

        # M2: bot.right_click (moveTo center + mouseDown/Up)
        print("--- M2 bot.right_click ---")
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.3)
        log_selected(r, player, "before_M2")
        rc = bot.right_click(safe_capture=False)
        print("rc", rc)
        time.sleep(0.7)
        hits = find_block(r, "dirt")
        print("M2 dirt hits", hits)
        methods.append(("M2", hits))
        for x, y, z in hits:
            r.command(f"setblock {x} {y} {z} air")

        # M3: title-bar focus then sky look + LMB to grab, then look down + RMB
        # Sky LMB: look straight up so punch cannot dig floor
        print("--- M3 sky-grab then place ---")
        bot.focus_minecraft(click_to_focus=True)
        time.sleep(0.2)
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} -90")
        time.sleep(0.35)
        bot.release_mouse()
        # left-click into empty sky to re-grab cursor without digging
        win = bot._find_window()
        if win and int(win.top) > 12:
            pyautogui.click(int(win.left + win.width * 0.5), int(win.top + 8))
        else:
            # borderless: click near top edge of client area (still sky after pitch -90)
            if win:
                cx = int(win.left + win.width * 0.5)
                cy = int(win.top + max(20, win.height * 0.08))
                print("borderless sky-click", cx, cy)
                pdi.click(x=cx, y=cy, button="left")
        time.sleep(0.25)
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.4)
        print("rot after reaim", r.command(f"data get entity {player} Rotation"))
        bot.select_hotbar(0)
        time.sleep(0.15)
        r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.25)
        bot.release_mouse()
        pdi.click(button="right")
        time.sleep(0.7)
        hits = find_block(r, "dirt")
        print("M3 dirt hits", hits)
        methods.append(("M3", hits))

        # M4: closer stand + look at face plane y=CY
        print("--- M4 closer + face-plane look ---")
        for x, y, z in hits:
            r.command(f"setblock {x} {y} {z} air")
        px2, py2, pz2 = CX + 0.5, float(CY), CZ - 1.05
        r.command(f"setblock {CX} {CY - 1} {CZ - 1} stone")  # footing under closer stand
        lx2, ly2, lz2 = CX + 0.5, float(CY), CZ + 0.5
        yaw2, pitch2 = yaw_pitch(px2, py2, pz2, lx2, ly2, lz2)
        print(f"M4 pose ({px2},{py2},{pz2}) look ({lx2},{ly2},{lz2}) yp={yaw2:.2f},{pitch2:.2f}")
        r.command(f"tp {player} {px2} {py2} {pz2} {yaw2:.2f} {pitch2:.2f}")
        time.sleep(0.45)
        bot.select_hotbar(0)
        time.sleep(0.1)
        r.command(f"tp {player} {px2} {py2} {pz2} {yaw2:.2f} {pitch2:.2f}")
        time.sleep(0.25)
        # sky grab again
        r.command(f"tp {player} {px2} {py2} {pz2} {yaw2:.2f} -90")
        time.sleep(0.2)
        if win:
            pdi.click(
                x=int(win.left + win.width * 0.5),
                y=int(win.top + max(20, win.height * 0.08)),
                button="left",
            )
        time.sleep(0.2)
        r.command(f"tp {player} {px2} {py2} {pz2} {yaw2:.2f} {pitch2:.2f}")
        time.sleep(0.35)
        pdi.click(button="right")
        time.sleep(0.7)
        hits = find_block(r, "dirt")
        print("M4 dirt hits", hits)
        methods.append(("M4", hits))

        bot.press_f2()
        time.sleep(0.4)
        post = capture_and_classify(bot, out_dir=shot, label="diag_post")
        print("post vision", getattr(post, "kind", post))

        print("SUMMARY", methods)
        exact = probe(r, CX, CY, CZ, "dirt")
        print("EXACT_CY_DIRT", exact)


if __name__ == "__main__":
    main()

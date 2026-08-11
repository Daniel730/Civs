"""Place smoke with Esc→re-grab (borderless). Must PASS twice in a row.

Proven path (2026-07-17): stand-close south + pitch~40 + RMB **without sneak**.
Sneak+RMB and overhead/levitation were failing in live probes; dirt/Civs overhead miss.
Esc ungrabs mouse → sky-LMB re-grab → tp look → RMB (no OS cursor move).
Never RIGHT_CLICK_AIR (Civs opens region menu).
"""
from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

from inventory import CIVS_SLOT, prepare_hotbar_for_placement, select_hotbar_key_and_verify
from qa_config import load_config
from rcon_client import RconClient
from test_structures import _rcon_block_is, _scan_chest_offsets
from vision import capture_and_classify
from window_bot import WindowBot


def yaw_pitch(px, py, pz, lx, ly, lz):
    ex, ey, ez = px, py + 1.62, pz
    dx, dy, dz = lx - ex, ly - ey, lz - ez
    dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    yaw = math.degrees(math.atan2(-dx, dz))
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, -dy / dist))))
    return yaw, pitch


def one_smoke(bot: WindowBot, r: RconClient, player: str, cx: int, cy: int, cz: int) -> dict:
    out: dict = {"center": [cx, cy, cz], "exact_cy": False, "neighbors": {}, "grab": None}

    r.command(f"gamemode creative {player}")
    # Continuous floor; clear chests so unsneaked RMB cannot open a container
    r.command(f"fill {cx - 2} {cy - 1} {cz - 3} {cx + 2} {cy - 1} {cz + 2} stone")
    r.command(f"fill {cx - 2} {cy} {cz - 3} {cx + 2} {cy + 3} {cz + 2} air")
    for dx in range(-4, 5):
        for dy in range(0, 4):
            for dz in range(-4, 5):
                if _rcon_block_is(r, cx + dx, cy + dy, cz + dz, "chest"):
                    r.command(f"setblock {cx + dx} {cy + dy} {cz + dz} air")
    r.command(f"setblock {cx} {cy - 1} {cz} stone replace")

    prep = prepare_hotbar_for_placement(
        r, player, "shelter", preferred_slot=CIVS_SLOT, bot=bot
    )
    out["prep"] = {"ok": prep.get("ok"), "error": prep.get("error")}
    if not prep.get("ok"):
        out["error"] = prep.get("error") or "hotbar prep failed"
        return out

    bot.press_escape(1)
    time.sleep(0.25)
    bot.press_escape(1)
    time.sleep(0.2)

    ks = select_hotbar_key_and_verify(bot, r, player, "shelter", CIVS_SLOT)
    out["hotbar"] = {
        "ok": ks.get("ok"),
        "civs_key": ks.get("civs_key"),
        "error": ks.get("error"),
    }
    if not ks.get("ok"):
        out["error"] = ks.get("error") or "hotbar verify abort"
        return out

    px, py, pz = cx + 0.5, float(cy), cz - 1.15
    lx, ly, lz = cx + 0.5, float(cy) - 0.5, cz + 0.5  # into stone under center (TOP)
    yaw, pitch = yaw_pitch(px, py, pz, lx, ly, lz)

    grab = bot.ensure_mouse_grabbed(r, player, restore_yaw=yaw, restore_pitch=pitch)
    out["grab"] = grab
    r.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
    time.sleep(0.5)
    out["rot_before"] = r.command(f"data get entity {player} Rotation")[:80]
    out["hand"] = r.command(
        f"data get entity {player} SelectedItem.components.minecraft:custom_data"
    )[:120]

    bot.release_mouse()
    # No sneak: live probe showed sneak+RMB fails Civs place; area cleared of chests
    rc = bot.right_click(sneak=False, move_cursor=False)
    out["rc"] = rc
    time.sleep(0.25)
    out["rot_after"] = r.command(f"data get entity {player} Rotation")[:80]
    time.sleep(0.7)
    bot.press_escape(1)
    time.sleep(0.25)
    bot.ensure_mouse_grabbed(r, player, restore_yaw=0.0, restore_pitch=20.0)

    exact = _rcon_block_is(r, cx, cy, cz, "chest")
    scan = _scan_chest_offsets(r, cx, cy, cz)
    out["exact_cy"] = exact
    out["neighbors"] = scan
    out["ok"] = bool(exact)
    if exact:
        r.command(f"setblock {cx} {cy} {cz} air")
        bot.press_escape(1)
        time.sleep(0.2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--base-x", type=int, default=2330)
    args = ap.parse_args()

    c = load_config()
    player = c.player_name
    bot = WindowBot(c.window_bot)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    results: list[dict] = []

    with RconClient(c.rcon) as r:
        print("list", r.command("list"))
        for i in range(args.runs):
            cx = args.base_x + i * 20
            cy, cz = 81, args.base_x + i * 20
            print(f"=== smoke {i + 1}/{args.runs} @ {cx} {cy} {cz} ===")
            one = one_smoke(bot, r, player, cx, cy, cz)
            results.append(one)
            print(
                "result",
                "PASS" if one.get("ok") else "FAIL",
                "exact",
                one.get("exact_cy"),
                "rot",
                one.get("rot_before"),
                "->",
                one.get("rot_after"),
                "scan",
                one.get("neighbors"),
            )
            bot.press_f2()
            time.sleep(0.35)
            capture_and_classify(
                bot,
                out_dir=Path("reports/screenshots"),
                label=f"place_smoke_run{i + 1}",
            )
            if not one.get("ok"):
                break
            time.sleep(0.5)

    passed_n = sum(1 for x in results if x.get("ok"))
    verdict = "PASS" if passed_n == args.runs else "FAIL"
    md_path = Path(f"reports/place_smoke_{stamp}.md")
    json_path = Path(f"reports/place_smoke_{stamp}.json")
    lines = [
        f"# Place smoke — {stamp}",
        "",
        f"## Verdict: **{verdict}** ({passed_n}/{args.runs})",
        "",
        "- Method: Esc ungrab → sky-LMB re-grab → stand-close + RMB (no sneak, no cursor move)",
        "- Hotbar: Civs slot 0 verified; no viewport LMB dig for focus",
        "",
    ]
    for i, one in enumerate(results, 1):
        lines.append(
            f"- Run {i} @ `{one.get('center')}`: "
            f"**{'PASS' if one.get('ok') else 'FAIL'}** "
            f"exact_cy=`{one.get('exact_cy')}` neighbors=`{one.get('neighbors')}`"
        )
        if one.get("error"):
            lines.append(f"  - error: `{one['error']}`")
    lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    json_path.write_text(
        json.dumps({"verdict": verdict, "results": results}, indent=2, default=str),
        encoding="utf-8",
    )
    print("VERDICT", verdict, md_path)
    if verdict != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

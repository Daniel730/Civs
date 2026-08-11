#!/usr/bin/env python3
"""Civs QA entry point: RCON smoke, structure batch, feature checks.

Default structure path is **fast** (RCON fill + /cv give + /cv placeregion).
Use `--legacy-window` for the old Esc/WE-wand/aim mouse path.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from inventory import format_snapshot_md, snapshot_inventory, snapshot_to_dict
from qa_config import enable_rcon_wsl, load_config
from rcon_client import RconClient, smoke_test
from test_features import run_feature_tests, write_report as write_features_report
from test_menus import run_menu_tests, write_report as write_menus_report
from test_structures import run_structure_tests, write_report as write_structures_report
from test_structures_fast import run_fast_structure_tests, write_fast_report
from window_bot import WindowBot


def cmd_smoke(cfg, args) -> int:
    if args.enable_rcon:
        pwd = cfg.rcon.password or "civsqa"
        res = enable_rcon_wsl(pwd)
        print("enable-rcon:", res.get("stdout") or res.get("stderr"))
        cfg.rcon.password = pwd

    result = smoke_test(cfg.rcon)
    print("RCON list:", result.get("list_output") or result.get("error"))
    if not result["ok"]:
        return 1

    if args.window:
        bot = WindowBot(cfg.window_bot)
        w = bot.send_chat_command(args.window_cmd)
        print("Window bot:", w)
        if not w.get("ok"):
            return 2
    return 0


def cmd_inventory(cfg, args) -> int:
    with RconClient(cfg.rcon) as client:
        snap = snapshot_inventory(client, cfg.player_name)
    print(format_snapshot_md(snap))
    out = cfg.reports_dir / f"inventory_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(snapshot_to_dict(snap), indent=2), encoding="utf-8")
    print("Wrote", out)
    return 0 if not snap.error else 1


def cmd_structures(cfg, args) -> int:
    if getattr(args, "legacy_window", False):
        report = run_structure_tests(
            cfg,
            names=args.only or None,
            place=not args.no_place,
            skip_window=args.skip_window,
        )
        path = write_structures_report(cfg, report)
        print(
            json.dumps(
                {
                    "mode": "legacy-window",
                    "report": str(path),
                    "activated": report.get("activated"),
                    "built": report.get("built"),
                    "passed": report["passed"],
                    "total": report["total"],
                },
                indent=2,
            )
        )
        return 0 if report.get("built", 0) >= 1 or report.get("passed_static_pad", 0) >= 1 else 1

    report = run_fast_structure_tests(cfg, names=args.only or None)
    path = write_fast_report(cfg, report)
    print(
        json.dumps(
            {
                "mode": "fast",
                "report": str(path),
                "wall_clock_s": report.get("wall_clock_s"),
                "activated": report.get("activated"),
                "attempted": report.get("attempted"),
                "io_pass": report.get("io_pass"),
                "io_fail": report.get("io_fail"),
                "io_skip": report.get("io_skip"),
                "target_met": (report.get("throughput") or {}).get("target_met"),
            },
            indent=2,
        )
    )
    return 0 if report.get("attempted", 0) >= 1 else 1


def cmd_fast(cfg, args) -> int:
    """Structures fast + short RCON feature smoke (no menus GUI)."""
    t0 = datetime.now(timezone.utc)
    struct_code = cmd_structures(
        cfg,
        argparse.Namespace(only=args.only, legacy_window=False, no_place=False, skip_window=True),
    )
    feat = run_feature_tests(cfg, skip_window=True)
    feat_path = write_features_report(cfg, feat)
    summary = {
        "mode": "fast",
        "timestamp": t0.isoformat(),
        "structures_exit": struct_code,
        "features_rcon": feat.get("rcon_passed"),
        "features_report": str(feat_path),
        "softhook": feat.get("softhook_notes"),
    }
    out = cfg.reports_dir / f"fast_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("Fast suite summary:", out)
    print(json.dumps(summary, indent=2))
    return struct_code


def cmd_features(cfg, args) -> int:
    report = run_feature_tests(cfg, skip_window=args.skip_window)
    path = write_features_report(cfg, report)
    print(json.dumps({"report": str(path), "rcon": report["rcon_passed"], "window": report["window_passed"]}, indent=2))
    return 0


def cmd_menus(cfg, args) -> int:
    report = run_menu_tests(cfg, skip_window=args.skip_window)
    path = write_menus_report(cfg, report)
    print(
        json.dumps(
            {
                "report": str(path),
                "passed": report["passed"],
                "total": report["total"],
                "failed": report.get("failed"),
            },
            indent=2,
        )
    )
    if args.skip_window:
        return 0
    critical = {"esc_close", "open_cv_menu", "open_rpg_hub", "wand_after_reset", "wand_after_menus"}
    crit_fail = [s for s in report["steps"] if s["name"] in critical and not s["ok"]]
    return 1 if crit_fail else 0


def cmd_all(cfg, args) -> int:
    codes = []
    codes.append(
        cmd_smoke(
            cfg,
            argparse.Namespace(
                enable_rcon=args.enable_rcon,
                window=args.window,
                window_cmd=args.window_cmd,
            ),
        )
    )
    codes.append(cmd_inventory(cfg, args))
    codes.append(
        cmd_structures(
            cfg,
            argparse.Namespace(
                only=args.only,
                no_place=args.no_place,
                skip_window=args.skip_window,
                legacy_window=getattr(args, "legacy_window", False),
            ),
        )
    )
    codes.append(cmd_features(cfg, args))
    if not getattr(args, "skip_menus", False):
        codes.append(cmd_menus(cfg, args))

    summary = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "smoke_exit": codes[0],
        "inventory_exit": codes[1],
        "structures_exit": codes[2],
        "features_exit": codes[3],
        "window_required": not args.skip_window,
    }
    out = cfg.reports_dir / f"run_all_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("Summary written:", out)
    return max(codes)


def main() -> int:
    parser = argparse.ArgumentParser(description="Civs QA automation")
    parser.add_argument("--config", type=Path, default=None)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_smoke = sub.add_parser("smoke", help="RCON list + optional window command")
    p_smoke.add_argument("--enable-rcon", action="store_true", help="Patch WSL server.properties")
    p_smoke.add_argument("--window", action="store_true", help="Send one chat command via window bot")
    p_smoke.add_argument("--window-cmd", default="//wand")

    p_struct = sub.add_parser(
        "structures",
        help="FAST default: RCON fill + cv give + cv placeregion. Use --legacy-window for mouse/WE.",
    )
    p_struct.add_argument("--only", nargs="*", help="Limit to these item-type keys")
    p_struct.add_argument("--no-place", action="store_true", help="(legacy) Static+pad only")
    p_struct.add_argument("--skip-window", action="store_true", help="(legacy) skip window bot")
    p_struct.add_argument(
        "--legacy-window",
        action="store_true",
        help="Slow path: WE wand + Esc + aim place (debug only)",
    )

    p_fast = sub.add_parser("fast", help="Fast structures + RCON-only feature smoke")
    p_fast.add_argument("--only", nargs="*", help="Limit structure keys")

    p_inv = sub.add_parser("inventory", help="Dump Smokeshow hand/hotbar/inventory via RCON")

    p_feat = sub.add_parser("features", help="Menus, mobs, RPG")
    p_feat.add_argument("--skip-window", action="store_true")

    p_menus = sub.add_parser("menus", help="GUI click-through (Civs main + RPG hub Magias)")
    p_menus.add_argument("--skip-window", action="store_true")

    p_all = sub.add_parser("all", help="smoke + inventory + structures + features + menus")
    p_all.add_argument("--enable-rcon", action="store_true")
    p_all.add_argument("--window", action="store_true")
    p_all.add_argument("--window-cmd", default="//wand")
    p_all.add_argument("--skip-window", action="store_true")
    p_all.add_argument("--legacy-window", action="store_true")
    p_all.add_argument("--only", nargs="*")
    p_all.add_argument("--no-place", action="store_true")

    args = parser.parse_args()
    cfg = load_config(args.config)

    if args.cmd == "smoke":
        return cmd_smoke(cfg, args)
    if args.cmd == "inventory":
        return cmd_inventory(cfg, args)
    if args.cmd == "structures":
        return cmd_structures(cfg, args)
    if args.cmd == "fast":
        return cmd_fast(cfg, args)
    if args.cmd == "features":
        return cmd_features(cfg, args)
    if args.cmd == "menus":
        return cmd_menus(cfg, args)
    if args.cmd == "all":
        return cmd_all(cfg, args)
    return 1


if __name__ == "__main__":
    sys.exit(main())

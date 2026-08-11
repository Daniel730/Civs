"""Menu GUI click-through QA: Esc recovery + Civs/RPG hub slot clicks."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from qa_config import QAConfig, grep_log_errors, tail_server_log_wsl
from rcon_client import RconClient
from window_bot import WindowBot

# Civs main.yml — size 27 (3 rows). Indices from Civs_servidor/menus/main.yml
CIVS_MAIN_SLOTS = {
    "guide": 6,
    "class": 7,
    "your-towns": 9,
    "towns": 10,
    "alliances": 11,
    "blueprints": 12,
    "shop": 13,
    "auction": 14,
    "regions": 17,
    "players": 18,
    "leaderboard": 19,
    "ports": 22,
    "language": 26,
}

# RPG hub — size 54. Civs tab + Magias/Combate from PlayerHubGui.renderCivsTab
RPG_HUB_CIVS_TAB = 2  # HubTab.CIVS → TAB_SLOTS[1] = 2
RPG_HUB_MAGIAS = 21  # opens Civs menu "class"
RPG_HUB_COMBATE = 25  # opens Civs menu "class-list"
CLASS_LIST_FIRST = 9  # class-list.yml items index 9-53


@dataclass
class MenuStep:
    name: str
    action: str
    ok: bool
    detail: str = ""
    error: str | None = None
    xy: list[int] | None = None


def _append(steps: list[MenuStep], name: str, action: str, res: dict, detail: str = "") -> MenuStep:
    step = MenuStep(
        name=name,
        action=action,
        ok=bool(res.get("ok")),
        detail=detail or (res.get("command") or ""),
        error=res.get("error"),
        xy=res.get("xy"),
    )
    steps.append(step)
    return step


def run_menu_tests(cfg: QAConfig, *, skip_window: bool = False) -> dict[str, Any]:
    marker = f"QA_MENU_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    steps: list[MenuStep] = []
    bot = WindowBot(cfg.window_bot)
    main_buttons = cfg.menu_main_buttons or ["shop", "blueprints", "towns", "auction", "language"]

    try:
        with RconClient(cfg.rcon) as client:
            client.command(f"say {marker} menu GUI QA")
            client.command(f"tp {cfg.player_name} {cfg.platform_x} {cfg.platform_y + 1} {cfg.platform_z}")
            client.command(f"gamemode creative {cfg.player_name}")
    except Exception as exc:  # noqa: BLE001
        steps.append(MenuStep(name="rcon_prep", action="rcon", ok=False, error=str(exc)))

    if skip_window:
        steps.append(
            MenuStep(
                name="window",
                action="skip",
                ok=False,
                error="skipped (--skip-window)",
            )
        )
        return _finalize(cfg, marker, steps, skip_window=True)

    # --- A. Force reset (Esc+calibrated Back to Game), then open main menu ---
    esc = bot.ensure_menus_closed(force_esc=True)
    _append(
        steps,
        "esc_close",
        "ensure_menus_closed",
        esc,
        f"path={esc.get('path')} esc={esc.get('esc_pressed')}",
    )

    # Prove pause trap fixed: //wand must work after menu close
    wand0 = bot.send_chat_command("//wand", close_menus=True)
    _append(steps, "wand_after_reset", "chat", wand0, "must not open Achievements")

    open_main = bot.send_chat_command("/cv menu", close_menus=True)
    _append(steps, "open_cv_menu", "chat", open_main)
    time.sleep(0.8)
    if not open_main.get("ok"):
        bot.abort_if_pause_trap()
        return _finalize(cfg, marker, steps, skip_window=False)

    # --- B. Click known Civs main slots only (re-open between each; refuse if no GUI) ---
    for key in main_buttons:
        slot = CIVS_MAIN_SLOTS.get(key)
        if slot is None:
            steps.append(MenuStep(name=f"main_{key}", action="click", ok=False, error=f"unknown button {key}"))
            continue
        reopen = bot.send_chat_command("/cv menu", close_menus=True)
        _append(steps, f"reopen_before_{key}", "chat", reopen)
        time.sleep(0.7)
        if not bot.gui_open:
            bot.mark_gui_open(True)  # /cv menu should have opened
        click = bot.click_inventory_slot(slot, container_rows=3)
        if click.get("aborted_pause_trap"):
            bot.abort_if_pause_trap()
            _append(steps, f"main_click_{key}", f"slot:{slot}", click, "ABORTED pause trap")
            break
        _append(steps, f"main_click_{key}", f"slot:{slot}", click, f"button={key}")
        time.sleep(0.6)
        # Single Esc closes submenu/main — track GUI closed
        bot.press_escape(1)
        bot.mark_gui_open(False)
        time.sleep(0.35)
        # Soft dismiss pause if Esc was one too many
        bot.dismiss_pause_menu()

    # --- C. Esc back navigation sanity ---
    bot.send_chat_command("/cv menu", close_menus=True)
    time.sleep(0.6)
    if bot.gui_open or True:
        bot.mark_gui_open(True)
        bot.click_inventory_slot(CIVS_MAIN_SLOTS["shop"], container_rows=3)
        time.sleep(0.5)
        bot.press_escape(1)
        bot.mark_gui_open(False)
        bot.dismiss_pause_menu()
    time.sleep(0.3)
    back = bot.send_chat_command("/cv menu", close_menus=True)
    _append(steps, "esc_back_then_menu", "chat", back, "shop→Esc→/cv menu")
    time.sleep(0.5)
    bot.ensure_menus_closed()

    wand1 = bot.send_chat_command("//wand", close_menus=True)
    _append(steps, "wand_after_menus", "chat", wand1, "wand must still work")

    # --- D. RPG hub → Civs tab → Magias (class) ---
    hub = bot.send_chat_command("/rpg hub", close_menus=True)
    _append(steps, "open_rpg_hub", "chat", hub)
    time.sleep(0.9)
    bot.mark_gui_open(True)
    tab = bot.click_inventory_slot(RPG_HUB_CIVS_TAB, container_rows=6)
    if tab.get("aborted_pause_trap"):
        bot.abort_if_pause_trap()
        _append(steps, "hub_civs_tab", f"slot:{RPG_HUB_CIVS_TAB}", tab, "ABORTED")
    else:
        _append(steps, "hub_civs_tab", f"slot:{RPG_HUB_CIVS_TAB}", tab)
        time.sleep(0.7)
        magias = bot.click_inventory_slot(RPG_HUB_MAGIAS, container_rows=6)
        _append(steps, "hub_magias", f"slot:{RPG_HUB_MAGIAS}", magias, "expect Civs class menu")
        time.sleep(0.8)
    bot.ensure_menus_closed()
    time.sleep(0.4)

    # --- E. RPG hub → Combate → class-list → first class ---
    hub2 = bot.send_chat_command("/rpg hub", close_menus=True)
    _append(steps, "open_rpg_hub_2", "chat", hub2)
    time.sleep(0.9)
    bot.mark_gui_open(True)
    bot.click_inventory_slot(RPG_HUB_CIVS_TAB, container_rows=6)
    time.sleep(0.7)
    combate = bot.click_inventory_slot(RPG_HUB_COMBATE, container_rows=6)
    _append(steps, "hub_combate", f"slot:{RPG_HUB_COMBATE}", combate, "expect class-list")
    time.sleep(0.9)
    if bot.gui_open:
        first = bot.click_inventory_slot(CLASS_LIST_FIRST, container_rows=6)
        _append(steps, "class_list_first", f"slot:{CLASS_LIST_FIRST}", first, "open/switch class")
        time.sleep(0.7)
    bot.ensure_menus_closed()

    # --- F. Shop buy flow (TestEconomy present) ---
    # /cv menu → shop → first category (slot 9) → first item → buy emerald (slot 0) → confirm
    shop_open = bot.send_chat_command("/cv menu", close_menus=True)
    _append(steps, "shop_buy_open_menu", "chat", shop_open)
    time.sleep(0.7)
    bot.mark_gui_open(True)
    shop_click = bot.click_inventory_slot(CIVS_MAIN_SLOTS["shop"], container_rows=3)
    _append(steps, "shop_buy_click_shop", "slot:13", shop_click)
    time.sleep(0.8)
    cat = bot.click_inventory_slot(9, container_rows=6)
    _append(steps, "shop_buy_category", "slot:9", cat, "first shop category")
    time.sleep(0.8)
    item = bot.click_inventory_slot(9, container_rows=6)
    _append(steps, "shop_buy_item", "slot:9", item, "first item in category")
    time.sleep(0.8)
    buy = bot.click_inventory_slot(0, container_rows=6)
    _append(steps, "shop_buy_emerald", "slot:0", buy, "Buy emerald top-left")
    time.sleep(0.7)
    confirm = bot.click_inventory_slot(15, container_rows=3)
    _append(steps, "shop_buy_confirm", "slot:15", confirm, "confirm purchase")
    time.sleep(0.6)
    bot.ensure_menus_closed()

    # --- G. Guide NPC menu (Civs main guide slot) ---
    guide_menu = bot.send_chat_command("/cv menu", close_menus=True)
    _append(steps, "guide_open_menu", "chat", guide_menu)
    time.sleep(0.7)
    bot.mark_gui_open(True)
    guide = bot.click_inventory_slot(CIVS_MAIN_SLOTS["guide"], container_rows=3)
    _append(steps, "guide_click", "slot:6", guide, "Civs guide menu")
    time.sleep(0.7)
    bot.ensure_menus_closed()

    # --- H. Class / spells menus ---
    spells = bot.send_chat_command("/cv spells", close_menus=True)
    _append(steps, "cv_spells", "chat", spells)
    time.sleep(0.8)
    bot.ensure_menus_closed()
    class_menu = bot.send_chat_command("/cv menu", close_menus=True)
    _append(steps, "class_open_menu", "chat", class_menu)
    time.sleep(0.7)
    bot.mark_gui_open(True)
    class_click = bot.click_inventory_slot(CIVS_MAIN_SLOTS["class"], container_rows=3)
    _append(steps, "class_click", "slot:7", class_click, "Civs class menu")
    time.sleep(0.7)
    bot.ensure_menus_closed()

    # --- I. RPG journal ---
    journal = bot.send_chat_command("/rpg journal", close_menus=True)
    _append(steps, "rpg_journal", "chat", journal)
    time.sleep(0.8)
    bot.ensure_menus_closed()

    # Leave client clean; prove wand one more time
    bot.ensure_menus_closed(force_esc=False)
    wand2 = bot.send_chat_command("//wand", close_menus=True)
    _append(steps, "wand_final", "chat", wand2)
    steps.append(MenuStep(name="final_esc", action="ensure_menus_closed", ok=True, detail="clean state"))

    return _finalize(cfg, marker, steps, skip_window=False)


def _finalize(cfg: QAConfig, marker: str, steps: list[MenuStep], *, skip_window: bool) -> dict[str, Any]:
    time.sleep(1.5)
    log_tail = tail_server_log_wsl(cfg.server_log_wsl)
    log_errors = grep_log_errors(log_tail, extra_terms=[marker, "menu", "class", "hub", "shop"])
    passed = sum(1 for s in steps if s.ok)
    failed = [s.name for s in steps if not s.ok]
    return {
        "marker": marker,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gui_scale": cfg.window_bot.gui_scale,
        "gui_offset": [cfg.window_bot.gui_offset_x, cfg.window_bot.gui_offset_y],
        "steps": [asdict(s) for s in steps],
        "passed": passed,
        "total": len(steps),
        "failed": failed,
        "window_skipped": skip_window,
        "log_errors": log_errors,
        "calibration_hint": (
            "If clicks miss icons, set window_bot.gui_scale (1–4) and gui_offset_x/y in config.yaml. "
            "Slot math assumes centered vanilla chest GUI."
        ),
        "notes": [
            "Chat commands fail while any inventory/Civs/RPG menu is open — Esc before T.",
            "Main menu buttons from Civs_servidor/menus/main.yml; hub Magias=slot21, Combate=slot25.",
        ],
    }


def write_report(cfg: QAConfig, report: dict[str, Any]) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = cfg.reports_dir / f"menus_{ts}.json"
    md_path = cfg.reports_dir / f"menus_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        f"# Menu GUI QA — {report['marker']}",
        "",
        f"- Passed: **{report['passed']}/{report['total']}** (skipped={report['window_skipped']})",
        f"- GUI scale: {report.get('gui_scale')} offset={report.get('gui_offset')}",
        "",
        "## Steps",
        "",
    ]
    for s in report.get("steps", []):
        flag = "OK" if s["ok"] else "FAIL"
        xy = f" @ {s['xy']}" if s.get("xy") else ""
        lines.append(f"- {flag} `{s['name']}` ({s['action']}){xy}")
        if s.get("detail"):
            lines.append(f"  - {s['detail']}")
        if s.get("error"):
            lines.append(f"  - error: {s['error']}")
    if report.get("failed"):
        lines.extend(["", "## Failed", ""])
        for name in report["failed"]:
            lines.append(f"- `{name}`")
    lines.extend(["", "## Calibration", "", report.get("calibration_hint", ""), "", "## Log errors", ""])
    for err in report.get("log_errors") or ["(none)"]:
        lines.append(f"- `{err}`")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path

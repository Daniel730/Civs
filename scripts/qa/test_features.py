"""Feature QA: menus, mobs, RPG, farms via RCON + window bot."""

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


@dataclass
class StepResult:
    kind: str
    command: str
    ok: bool
    output: str = ""
    error: str | None = None
    needs_window: bool = False


def run_rcon_steps(cfg: QAConfig, client: RconClient) -> list[StepResult]:
    steps: list[StepResult] = []
    subs = {
        "player": cfg.player_name,
        "x": str(cfg.platform_x),
        "y": str(cfg.platform_y + 1),
        "z": str(cfg.platform_z),
    }
    base = [
        "list",
        f"tp {cfg.player_name} {cfg.platform_x} {cfg.platform_y + 1} {cfg.platform_z}",
        "cv reload",
        "rpg reload",
        "cv newday",
    ]
    # Document-only probes (do not mutate town membership here)
    base.append("say QA_FEAT probe rpg journal / cv leave deferred to dedicated cases")
    for mob in cfg.mob_spawns:
        base.append(f"cv mob spawn {mob} {cfg.player_name}")
    for tpl in cfg.rcon_only:
        cmd = tpl.format(**subs)
        if cmd not in base:
            base.append(cmd)

    for cmd in base:
        try:
            out = client.command(cmd)
            steps.append(StepResult(kind="rcon", command=cmd, ok=True, output=out[:500]))
        except Exception as exc:  # noqa: BLE001
            steps.append(StepResult(kind="rcon", command=cmd, ok=False, error=str(exc)))
        time.sleep(0.05)  # was 0.35 — RCON-only feature smoke
    return steps


def run_window_steps(cfg: QAConfig) -> list[StepResult]:
    bot = WindowBot(cfg.window_bot)
    steps: list[StepResult] = []
    all_cmds = list(cfg.player_commands) + list(cfg.rpg_commands)
    for cmd in all_cmds:
        res = bot.send_chat_command(cmd)
        steps.append(
            StepResult(
                kind="window",
                command=cmd,
                ok=bool(res.get("ok")),
                output="focused" if res.get("focused") else "not focused",
                error=res.get("error"),
                needs_window=True,
            )
        )
        time.sleep(0.6)
        # Close menus opened by /cv menu, /rpg hub, etc.
        bot.ensure_menus_closed(force_esc=False)
        time.sleep(0.25)

    # Combat bar: RMB cast only (no LMB). Open spells then right-click once in world.
    bot.ensure_menus_closed(force_esc=True)
    time.sleep(0.3)
    sp = bot.send_chat_command("/cv spells", close_menus=True)
    steps.append(
        StepResult(
            kind="window",
            command="/cv spells (combat prep)",
            ok=bool(sp.get("ok")),
            output="focused" if sp.get("focused") else "not focused",
            error=sp.get("error"),
            needs_window=True,
        )
    )
    time.sleep(0.6)
    bot.ensure_menus_closed(force_esc=False)
    time.sleep(0.3)
    # Ensure mouse grabbed then RMB (cast) — never LMB dig
    try:
        from qa_config import load_config  # noqa: F401

        with RconClient(cfg.rcon) as client:
            client.command(f"gamemode creative {cfg.player_name}")
            bot.ensure_mouse_grabbed(client, cfg.player_name, restore_yaw=0, restore_pitch=20)
    except Exception as exc:  # noqa: BLE001
        steps.append(
            StepResult(
                kind="window",
                command="combat_mouse_grab",
                ok=False,
                error=str(exc),
                needs_window=True,
            )
        )
    rc = bot.right_click(safe_capture=False, sneak=False, move_cursor=False)
    steps.append(
        StepResult(
            kind="window",
            command="combat_bar_rmb_cast",
            ok=bool(rc.get("ok")),
            output=str(rc)[:200],
            error=rc.get("error"),
            needs_window=True,
        )
    )
    time.sleep(0.5)

    # Mana BossBar: F2 screenshot then classify (presence is best-effort via vision notes)
    try:
        from pathlib import Path

        from vision import capture_and_classify

        vr = capture_and_classify(
            bot, out_dir=Path("reports/screenshots"), label="mana_bossbar_probe"
        )
        notes = (vr.notes if hasattr(vr, "notes") else "") or ""
        kind = vr.kind if hasattr(vr, "kind") else str(vr)
        steps.append(
            StepResult(
                kind="window",
                command="mana_bossbar_f2",
                ok=kind in ("world", "hud", "bossbar") or "world" in str(kind),
                output=f"kind={kind} notes={notes[:160]}",
                needs_window=True,
            )
        )
    except Exception as exc:  # noqa: BLE001
        steps.append(
            StepResult(
                kind="window",
                command="mana_bossbar_f2",
                ok=False,
                error=str(exc),
                needs_window=True,
            )
        )

    bot.release_mouse()
    return steps


def run_feature_tests(cfg: QAConfig, skip_window: bool = False) -> dict[str, Any]:
    marker = f"QA_FEAT_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    steps: list[StepResult] = []
    softhook_notes: list[str] = []

    try:
        with RconClient(cfg.rcon) as client:
            client.command(f"say {marker} feature QA")
            steps.extend(run_rcon_steps(cfg, client))
            # SoftHook w/o AuraSkills: plugins list + prior boot log already shows RPG SoftHook
            try:
                plugs = client.command("plugins")
                has_aura = "AuraSkills" in (plugs or "")
                has_rpg = "RPGServer" in (plugs or "") or "RPG" in (plugs or "")
                softhook_notes.append(
                    f"AuraSkills={'present' if has_aura else 'absent'}; "
                    f"RPGServer={'present' if has_rpg else 'absent'}; "
                    "expect Civs SoftHook path without AuraSkills"
                )
                steps.append(
                    StepResult(
                        kind="rcon",
                        command="softhook_auraskills_probe",
                        ok=has_rpg and not has_aura,
                        output=softhook_notes[-1],
                    )
                )
            except Exception as exc:  # noqa: BLE001
                steps.append(
                    StepResult(
                        kind="rcon",
                        command="softhook_auraskills_probe",
                        ok=False,
                        error=str(exc),
                    )
                )
    except Exception as exc:  # noqa: BLE001
        steps.append(StepResult(kind="rcon", command="connect", ok=False, error=str(exc)))

    if not skip_window:
        steps.extend(run_window_steps(cfg))
    else:
        for cmd in cfg.player_commands + cfg.rpg_commands:
            steps.append(
                StepResult(
                    kind="window",
                    command=cmd,
                    ok=False,
                    error="skipped (--skip-window)",
                    needs_window=True,
                )
            )

    time.sleep(0.3)  # was 2s — brief log settle
    log_tail = tail_server_log_wsl(cfg.server_log_wsl)
    log_errors = grep_log_errors(
        log_tail, extra_terms=[marker, "mob", "menu", "rpg", "spell", "SoftHook", "AuraSkills", "guide"]
    )
    # Capture SoftHook evidence from log
    for line in (log_tail or "").splitlines():
        if "AuraSkills" in line or "SoftHook" in line or "skills internas" in line.lower():
            softhook_notes.append(line.strip()[:200])

    rcon_ok = sum(1 for s in steps if s.kind == "rcon" and s.ok)
    win_ok = sum(1 for s in steps if s.kind == "window" and s.ok)
    report = {
        "marker": marker,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "steps": [asdict(s) for s in steps],
        "rcon_passed": rcon_ok,
        "window_passed": win_ok,
        "window_skipped": skip_window,
        "log_errors": log_errors,
        "softhook_notes": softhook_notes,
        "needs_focus": [s.command for s in steps if s.needs_window and not s.ok],
    }
    return report


def write_report(cfg: QAConfig, report: dict[str, Any]) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = cfg.reports_dir / f"features_{ts}.json"
    md_path = cfg.reports_dir / f"features_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        f"# Feature QA — {report['marker']}",
        "",
        f"- RCON steps OK: **{report['rcon_passed']}**",
        f"- Window steps OK: **{report['window_passed']}** (skipped={report['window_skipped']})",
        "",
        "## Steps",
        "",
    ]
    for s in report.get("steps", []):
        flag = "OK" if s["ok"] else "FAIL"
        win = " [needs Minecraft focused + menus closed]" if s.get("needs_window") else ""
        lines.append(f"- {flag} `{s['command']}` ({s['kind']}){win}")
        if s.get("error"):
            lines.append(f"  - error: {s['error']}")
    lines.extend(
        [
            "",
            "## SoftHook / AuraSkills",
            "",
        ]
    )
    for note in report.get("softhook_notes") or ["(none)"]:
        lines.append(f"- `{note}`")
    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Window bot presses **Esc** before each chat command (open inventory/Civs menu blocks chat).",
            "- For GUI click-through use `python run_all.py menus`.",
            "- Combat cast probe uses RMB only (no LMB dig).",
            "- Mana BossBar via F2 screenshot classify (best-effort).",
            "",
            "## Log errors",
            "",
        ]
    )
    for err in report.get("log_errors") or ["(none)"]:
        lines.append(f"- `{err}`")
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path

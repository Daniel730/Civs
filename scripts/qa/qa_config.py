"""Shared config + log helpers for Civs QA scripts."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

from rcon_client import RconConfig
from window_bot import WindowBotConfig

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = SCRIPT_DIR / "config.yaml"
EXAMPLE_CONFIG = SCRIPT_DIR / "config.example.yaml"
REPORTS_DIR = SCRIPT_DIR / "reports"


@dataclass
class QAConfig:
    server_host: str = "127.0.0.1"
    server_port: int = 25565
    rcon: RconConfig = field(default_factory=RconConfig)
    player_name: str = "Smokeshow"
    window_title: str = "Minecraft"
    civs_repo: Path = Path(".")
    item_types_dir: Path = Path("Civs_servidor/item-types")
    server_log_wsl: str = "/home/dansilva/civs-testserver/logs/latest.log"
    blueprints_wsl: str = "/home/dansilva/civs-testserver/plugins/Civs/blueprints"
    platform_x: int = 2100
    platform_y: int = 80
    platform_z: int = 2100
    pad_size: int = 50
    structure_batch: list[str] = field(default_factory=list)
    window_bot: WindowBotConfig = field(default_factory=WindowBotConfig)
    mob_spawns: list[str] = field(default_factory=list)
    player_commands: list[str] = field(default_factory=list)
    rpg_commands: list[str] = field(default_factory=list)
    rcon_only: list[str] = field(default_factory=list)
    menu_main_buttons: list[str] = field(default_factory=list)

    @property
    def reports_dir(self) -> Path:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        return REPORTS_DIR


def load_config(path: Path | None = None) -> QAConfig:
    load_dotenv(SCRIPT_DIR / ".env")
    cfg_path = path or Path(os.environ.get("CIVS_QA_CONFIG", DEFAULT_CONFIG))
    if not cfg_path.exists():
        cfg_path = EXAMPLE_CONFIG
    with cfg_path.open(encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh) or {}

    repo = Path(raw.get("paths", {}).get("civs_repo", SCRIPT_DIR.parent.parent))
    item_rel = raw.get("paths", {}).get("item_types", "Civs_servidor/item-types")
    rcon_raw = raw.get("server", {}).get("rcon", {})
    password = os.environ.get("RCON_PASSWORD") or rcon_raw.get("password") or ""
    wb_raw = raw.get("window_bot", {})
    plat = raw.get("qa_platform", {})

    cfg = QAConfig(
        server_host=raw.get("server", {}).get("host", "127.0.0.1"),
        server_port=int(raw.get("server", {}).get("port", 25565)),
        rcon=RconConfig(
            host=rcon_raw.get("host", "127.0.0.1"),
            port=int(rcon_raw.get("port", 25575)),
            password=password,
        ),
        player_name=raw.get("player", {}).get("name", "Smokeshow"),
        window_title=raw.get("player", {}).get("window_title", "Minecraft"),
        civs_repo=repo,
        item_types_dir=(repo / item_rel).resolve(),
        server_log_wsl=raw.get("paths", {}).get("server_log", "/home/dansilva/civs-testserver/logs/latest.log"),
        blueprints_wsl=raw.get("paths", {}).get("blueprints", "/home/dansilva/civs-testserver/plugins/Civs/blueprints"),
        platform_x=int(plat.get("x", 2100)),
        platform_y=int(plat.get("y", 80)),
        platform_z=int(plat.get("z", 2100)),
        pad_size=int(plat.get("pad_size", 50)),
        structure_batch=list(raw.get("structures", {}).get("batch") or []),
        window_bot=WindowBotConfig(
            window_title=raw.get("player", {}).get("window_title", "Minecraft"),
            command_delay_ms=int(wb_raw.get("command_delay_ms", 400)),
            chat_open_key=str(wb_raw.get("chat_open_key", "t")),
            focus_retries=int(wb_raw.get("focus_retries", 5)),
            dry_run=bool(wb_raw.get("dry_run", False)),
            esc_before_chat=bool(wb_raw.get("esc_before_chat", True)),
            esc_retries=int(wb_raw.get("esc_retries", 1)),
            esc_delay_ms=int(wb_raw.get("esc_delay_ms", 250)),
            dismiss_pause_click=bool(wb_raw.get("dismiss_pause_click", True)),
            pause_resume_rel_x=float(wb_raw.get("pause_resume_rel_x", 0.5)),
            # MC 26.1.2 Back to Game ≈ 0.28; 0.40 hit Statistics (Daniel pause trap).
            pause_resume_rel_y=float(wb_raw.get("pause_resume_rel_y", 0.28)),
            pause_dismiss_method=str(wb_raw.get("pause_dismiss_method", "click")),
            gui_scale=int(wb_raw.get("gui_scale", 2)),
            gui_offset_x=int(wb_raw.get("gui_offset_x", 0)),
            gui_offset_y=int(wb_raw.get("gui_offset_y", 0)),
        ),
        mob_spawns=list(raw.get("features", {}).get("mob_spawns") or []),
        player_commands=list(raw.get("features", {}).get("player_commands") or []),
        rpg_commands=list(raw.get("features", {}).get("rpg_commands") or []),
        rcon_only=list(raw.get("rcon_only") or []),
        menu_main_buttons=list(
            raw.get("menus", {}).get("main_buttons")
            or ["shop", "blueprints", "towns", "auction", "language"]
        ),
    )
    return cfg


def tail_server_log_wsl(log_path: str, lines: int = 120) -> str:
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", f"tail -n {lines} '{log_path}' 2>/dev/null || true"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return out.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""


def grep_log_errors(log_text: str, extra_terms: list[str] | None = None) -> list[str]:
    terms = ["ERROR", "SEVERE", "Exception", "fail", "invalid"]
    if extra_terms:
        terms.extend(extra_terms)
    hits: list[str] = []
    for line in log_text.splitlines():
        low = line.lower()
        if any(t.lower() in low for t in terms):
            if any(k in low for k in ("civs", "rpg", "worldedit", "region", "blueprint", "farm", "menu", "mob")):
                hits.append(line.strip())
    return hits[-40:]


def enable_rcon_wsl(password: str, server_dir: str = "/home/dansilva/civs-testserver") -> dict:
    """Patch server.properties in WSL to enable RCON."""
    props = f"{server_dir}/server.properties"
    script = f"""
set -e
P='{props}'
touch "$P"
grep -q '^enable-rcon=' "$P" && sed -i 's/^enable-rcon=.*/enable-rcon=true/' "$P" || echo 'enable-rcon=true' >> "$P"
grep -q '^rcon.port=' "$P" && sed -i 's/^rcon.port=.*/rcon.port=25575/' "$P" || echo 'rcon.port=25575' >> "$P"
grep -q '^rcon.password=' "$P" && sed -i 's/^rcon.password=.*/rcon.password={password}/' "$P" || echo 'rcon.password={password}' >> "$P"
grep -E 'enable-rcon|rcon\\.' "$P"
"""
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        return {"ok": out.returncode == 0, "stdout": out.stdout, "stderr": out.stderr}
    except FileNotFoundError as exc:
        return {"ok": False, "stdout": "", "stderr": str(exc)}

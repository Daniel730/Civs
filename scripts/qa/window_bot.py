"""Focus Minecraft window and send chat commands / GUI clicks.

Chat commands fail while an inventory or Civs/RPG menu is open. Always Esc-close
GUIs before opening chat (T). Menu click-through uses calibrated chest-slot math.

Pause trap (Daniel 2026-07-17): Esc with no GUI open opens the Game Menu; a
mis-aimed "Back to Game" click hits Advancements/Statistics and breaks //wand.
Fix: track GUI-open state; Esc only when a GUI is open; dismiss pause with a
calibrated Back-to-Game click (never Advancements/Statistics Y bands).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import pyautogui
import pyperclip

try:
    import pydirectinput as pdi
except ImportError:  # pragma: no cover
    pdi = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

# Vanilla chest GUI texture sizes (pixels at GUI scale 1), including player inventory.
CHEST_GUI_WIDTH = 176
CHEST_GUI_HEIGHT = {
    3: 166,  # Generic_9x3 / size 27
    4: 184,
    5: 202,
    6: 222,  # Generic_9x6 / size 54
}

# Minecraft PauseScreen (26.1.2): Back to Game ≈ height/4 + 8 (button center ~0.28).
# Advancements / Statistics sit lower (~0.34–0.48) — never click those bands.
PAUSE_FORBIDDEN_Y_MIN = 0.33
PAUSE_FORBIDDEN_Y_MAX = 0.52


@dataclass
class WindowBotConfig:
    window_title: str = "Minecraft"
    command_delay_ms: int = 400
    chat_open_key: str = "t"
    focus_retries: int = 5
    dry_run: bool = False
    # Close inventory/menus before chat — Daniel: failures were open GUIs, not focus.
    esc_before_chat: bool = True
    # One Esc closes a container. A second Esc from gameplay opens the pause menu.
    esc_retries: int = 1
    esc_delay_ms: int = 250
    dismiss_pause_click: bool = True
    # Relative click for pause "Back to Game" (MC 26.1.2, gui_scale 3).
    # Was 0.40 → hit Statistics; corrected to ~0.28 (height/4 + button center).
    pause_resume_rel_x: float = 0.5
    pause_resume_rel_y: float = 0.28
    # Prefer Esc — click dismiss punches world when not actually paused (Daniel).
    pause_dismiss_method: str = "esc"  # "click" | "esc" | "esc_then_click"
    # Minecraft Options → Video Settings → GUI Scale (1–4; 0=Auto ≈2–3 on large screens).
    gui_scale: int = 2
    # Extra pixel nudge after auto-centering (calibration).
    gui_offset_x: int = 0
    gui_offset_y: int = 0


class WindowBotError(RuntimeError):
    pass


class WindowBot:
    def __init__(self, config: WindowBotConfig) -> None:
        self.config = config
        self._input = pdi if pdi is not None else pyautogui
        # Track whether we believe a container/Civs/RPG GUI is open.
        self.gui_open: bool = False

    def mark_gui_open(self, open_: bool = True) -> None:
        self.gui_open = open_

    def _find_window(self):
        title = self.config.window_title
        wins = pyautogui.getWindowsWithTitle(title)
        if not wins:
            wins = [w for w in pyautogui.getAllWindows() if title.lower() in (w.title or "").lower()]
        return wins[0] if wins else None

    def release_mouse(self) -> None:
        """Release LMB/RMB so we never hold dig/place across actions (Daniel)."""
        try:
            if pdi is not None:
                pdi.mouseUp(button="left")
                pdi.mouseUp(button="right")
            else:
                pyautogui.mouseUp(button="left")
                pyautogui.mouseUp(button="right")
        except Exception:  # noqa: BLE001
            pass

    def ensure_mouse_grabbed(
        self,
        client: Any = None,
        player: str | None = None,
        *,
        restore_yaw: float | None = None,
        restore_pitch: float | None = None,
    ) -> dict:
        """
        Re-capture Minecraft mouse after Esc/focus (borderless has no title bar).

        Pattern (proven for borderless): look at sky (pitch -90), move cursor into
        the game viewport, short LMB — cannot dig blocks. Caller should re-tp look
        after this when placing. Never uses viewport LMB while looking at blocks.
        """
        import re

        result = {"ok": False, "sky_click": False, "xy": None, "borderless": False}
        if not self.focus_minecraft(click_to_focus=False):
            result["error"] = "no window"
            return result
        try:
            win = self._find_window()
            if win is None:
                result["error"] = "no window after focus"
                return result
            # Borderless often reports top <= 0; still click inside client area.
            result["borderless"] = int(win.top) <= 12
            # Slightly above center: still in world view, safer if pitch restore lags.
            cx = int(win.left + win.width * 0.5)
            cy = int(win.top + win.height * 0.35)
            result["xy"] = [cx, cy]

            if client is not None and player:
                pos = client.command(f"data get entity {player} Pos")
                m = re.search(
                    r"\[([-0-9.]+)d,\s*([-0-9.]+)d,\s*([-0-9.]+)d\]", pos or ""
                )
                if m:
                    px, py, pz = float(m.group(1)), float(m.group(2)), float(m.group(3))
                    client.command(f"tp {player} {px} {py} {pz} 0 -90")
                    time.sleep(0.25)

            self.release_mouse()
            pyautogui.moveTo(cx, cy, duration=0.05)
            time.sleep(0.05)
            # Click at explicit viewport coords — cursor may be outside after Esc.
            if pdi is not None:
                pdi.click(x=cx, y=cy, button="left")
            else:
                pyautogui.click(x=cx, y=cy, button="left")
            result["sky_click"] = True
            time.sleep(0.15)

            if (
                client is not None
                and player
                and restore_yaw is not None
                and restore_pitch is not None
            ):
                pos = client.command(f"data get entity {player} Pos")
                m = re.search(
                    r"\[([-0-9.]+)d,\s*([-0-9.]+)d,\s*([-0-9.]+)d\]", pos or ""
                )
                if m:
                    px, py, pz = float(m.group(1)), float(m.group(2)), float(m.group(3))
                    client.command(
                        f"tp {player} {px} {py} {pz} {restore_yaw:.2f} {restore_pitch:.2f}"
                    )
                    time.sleep(0.15)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result

    def focus_minecraft(self, *, click_to_focus: bool = False) -> bool:
        """
        Bring Minecraft to foreground.

        Default: activate only — NO left-click (left-click on viewport breaks
        blocks when chest/fist is selected — Daniel live feedback).
        """
        for attempt in range(self.config.focus_retries):
            win = self._find_window()
            if win:
                try:
                    if win.isMinimized:
                        win.restore()
                    try:
                        win.activate()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Window activate attempt %s failed: %s", attempt + 1, exc)
                    self.release_mouse()
                    if click_to_focus:
                        # Title bar only when window has one (top > 12). Never viewport.
                        if int(win.top) > 12:
                            cx = int(win.left + win.width * 0.5)
                            cy = int(win.top + 8)
                            pyautogui.click(cx, cy)
                        else:
                            logger.info("borderless window — skip click-to-focus")
                    time.sleep(0.2)
                    return True
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Window focus attempt %s failed: %s", attempt + 1, exc)
            time.sleep(0.5)
        return False

    def press_escape(self, times: int | None = None) -> None:
        """Close chat, inventory, or plugin menus (does not dismiss pause by itself)."""
        n = self.config.esc_retries if times is None else times
        for _ in range(max(1, n)):
            if self.config.dry_run:
                logger.info("[dry-run] would press Esc")
            else:
                self._input.press("esc")
            time.sleep(self.config.esc_delay_ms / 1000.0)

    def _pause_click_is_safe(self, rel_y: float) -> bool:
        return not (PAUSE_FORBIDDEN_Y_MIN <= rel_y <= PAUSE_FORBIDDEN_Y_MAX)

    def dismiss_pause_menu(self) -> dict:
        """
        Dismiss Game Menu if open.

        Prefer calibrated Back to Game click. Never click Advancements/Statistics
        Y bands — fall back to Esc (closes pause when pause is open).
        """
        result = {"ok": True, "method": None, "xy": None, "skipped_unsafe_y": False}
        if self.config.dry_run or not self.config.dismiss_pause_click:
            result["method"] = "dry_run_or_disabled"
            return result

        method = (self.config.pause_dismiss_method or "click").lower()
        if method == "esc":
            self.press_escape(1)
            result["method"] = "esc"
            return result

        if method == "esc_then_click":
            self.press_escape(1)
            result["method"] = "esc_then_click"

        win = self._find_window()
        if win is None:
            result["ok"] = False
            result["method"] = "no_window"
            return result

        rel_x = self.config.pause_resume_rel_x
        rel_y = self.config.pause_resume_rel_y
        if not self._pause_click_is_safe(rel_y):
            logger.warning(
                "pause_resume_rel_y=%.2f is in Achievements/Statistics band — using Esc",
                rel_y,
            )
            self.press_escape(1)
            result["method"] = "esc_unsafe_y_guard"
            result["skipped_unsafe_y"] = True
            return result

        x = int(win.left + win.width * rel_x)
        y = int(win.top + win.height * rel_y)
        result["xy"] = [x, y]
        pyautogui.moveTo(x, y, duration=0.05)
        if pdi is not None:
            pdi.click(x=x, y=y)
        else:
            pyautogui.click(x=x, y=y)
        time.sleep(self.config.esc_delay_ms / 1000.0)
        result["method"] = result.get("method") or "click_back_to_game"
        return result

    def ensure_menus_closed(self, *, force_esc: bool = False) -> dict:
        """
        Return to gameplay so chat (T) works.

        Strategy (Daniel):
        - If a Civs/inventory GUI is open (tracked): single Esc only — closes GUI.
          Do NOT Esc again (that opens pause). Soft-dismiss pause afterward.
        - If no GUI tracked: do NOT Esc (Esc would open pause). Only click Back to Game
          in case pause was left open from a prior mistake.
        - force_esc=True: Esc once then dismiss pause (suite start / recovery).
        """
        result = {
            "ok": False,
            "focused": False,
            "esc_pressed": 0,
            "pause_dismissed": False,
            "gui_was_open": self.gui_open,
            "path": None,
            "error": None,
        }
        if self.config.dry_run:
            result["ok"] = True
            result["path"] = "dry_run"
            self.gui_open = False
            return result
        if not self.focus_minecraft():
            result["error"] = f"No window matching title {self.config.window_title!r}"
            return result
        result["focused"] = True

        was_gui = self.gui_open
        if self.gui_open or force_esc:
            self.press_escape(1)
            result["esc_pressed"] = 1
            self.gui_open = False
            time.sleep(0.2)
            if force_esc and not was_gui:
                # Esc from gameplay opens Game Menu — second Esc closes it.
                # (Click dismiss is unreliable on borderless / PT layouts.)
                self.press_escape(1)
                result["esc_pressed"] = 2
                result["path"] = "force_esc_toggle_pause"
                result["pause_dismissed"] = True
            else:
                # Closed a real GUI → should be in world. Soft-dismiss ONLY if
                # click-based; Esc dismiss would re-open pause and ungrab mouse.
                method = (self.config.pause_dismiss_method or "esc").lower()
                if method == "esc":
                    result["path"] = "gui_esc_only"
                    result["pause_dismissed"] = False
                    result["dismiss_detail"] = {
                        "ok": True,
                        "method": "skipped_esc_after_gui_close",
                    }
                else:
                    dismissed = self.dismiss_pause_menu()
                    result["pause_dismissed"] = bool(dismissed.get("ok"))
                    result["path"] = "gui_esc_then_soft_dismiss"
                    result["dismiss_detail"] = dismissed
        else:
            dismissed = self.dismiss_pause_menu()
            result["pause_dismissed"] = bool(dismissed.get("ok"))
            result["path"] = "pause_dismiss_only"
            result["dismiss_detail"] = dismissed

        result["ok"] = True
        return result

    def abort_if_pause_trap(self) -> dict:
        """Emergency: leave Achievements/Statistics/pause, return to gameplay."""
        result = {"ok": False, "esc_pressed": 0}
        if not self.focus_minecraft():
            return result
        # At most 2 Esc: Statistics→Game Menu→world (or pause→world).
        # A third Esc (or dismiss_pause_method=esc after world) re-opens pause
        # and un-grabs the mouse on borderless — do NOT Esc again here.
        for _ in range(2):
            self.press_escape(1)
            result["esc_pressed"] += 1
            time.sleep(0.25)
        method = (self.config.pause_dismiss_method or "esc").lower()
        if method == "esc":
            # Already toggled with Esc above; skip another Esc.
            result["dismiss"] = {"ok": True, "method": "skipped_esc_already_toggled"}
        else:
            result["dismiss"] = self.dismiss_pause_menu()
        self.gui_open = False
        result["ok"] = True
        return result

    def send_chat_command(self, command: str, *, close_menus: bool | None = None) -> dict:
        """
        Esc-close any open GUI (default), open chat, send command, press Enter.

        Leading slash optional; //wand and /cv menu both work.
        """
        cmd = command.strip()
        if not cmd.startswith("/") and not cmd.startswith("//"):
            cmd = "/" + cmd

        do_close = self.config.esc_before_chat if close_menus is None else close_menus
        result = {
            "ok": False,
            "command": cmd,
            "dry_run": self.config.dry_run,
            "focused": False,
            "menus_closed": False,
            "error": None,
        }

        if self.config.dry_run:
            logger.info("[dry-run] would send chat: %s (close_menus=%s)", cmd, do_close)
            result["ok"] = True
            result["menus_closed"] = bool(do_close)
            return result

        if not self.focus_minecraft():
            result["error"] = f"No window matching title {self.config.window_title!r}"
            return result
        result["focused"] = True

        try:
            if do_close:
                closed = self.ensure_menus_closed()
                if not closed.get("ok"):
                    result["error"] = closed.get("error") or "ensure_menus_closed failed"
                    return result
                result["menus_closed"] = True
                result["close_path"] = closed.get("path")
                time.sleep(0.1)

            self._input.press(self.config.chat_open_key)
            time.sleep(self.config.command_delay_ms / 1000.0)
            pyperclip.copy(cmd)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(0.1)
            self._input.press("enter")
            time.sleep(self.config.command_delay_ms / 1000.0)
            result["ok"] = True
            low = cmd.lower()
            if any(x in low for x in ("/cv menu", "/rpg hub", "/cv shop", "placement")):
                self.gui_open = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
            if "menu" in cmd.lower() or result.get("menus_closed") is False:
                result["error"] = (
                    f"{exc} (hint: chat fails while inventory/Civs menu is open — Esc then retry)"
                )
        return result

    def send_commands(self, commands: list[str]) -> list[dict]:
        return [self.send_chat_command(c) for c in commands]

    def slot_screen_xy(self, slot: int, container_rows: int = 3) -> tuple[int, int]:
        """Map a chest-style inventory slot (0-based) to absolute screen coordinates."""
        win = self._find_window()
        if win is None:
            raise WindowBotError(f"No window matching title {self.config.window_title!r}")

        rows = container_rows if container_rows in CHEST_GUI_HEIGHT else 3
        scale = max(1, int(self.config.gui_scale))
        gui_w = CHEST_GUI_WIDTH * scale
        gui_h = CHEST_GUI_HEIGHT[rows] * scale

        cx = win.left + win.width // 2 + self.config.gui_offset_x
        cy = win.top + win.height // 2 + self.config.gui_offset_y
        left = cx - gui_w // 2
        top = cy - gui_h // 2

        col = slot % 9
        row = slot // 9
        x = left + (8 + col * 18 + 9) * scale
        y = top + (18 + row * 18 + 9) * scale
        return int(x), int(y)

    def click_inventory_slot(
        self,
        slot: int,
        *,
        container_rows: int = 3,
        button: str = "left",
        clicks: int = 1,
    ) -> dict:
        """Click a chest GUI slot. Does NOT press Esc first (menu must stay open)."""
        result = {
            "ok": False,
            "slot": slot,
            "container_rows": container_rows,
            "xy": None,
            "dry_run": self.config.dry_run,
            "focused": False,
            "error": None,
        }
        if self.config.dry_run:
            logger.info("[dry-run] would click slot %s (rows=%s)", slot, container_rows)
            result["ok"] = True
            return result

        if not self.focus_minecraft():
            result["error"] = f"No window matching title {self.config.window_title!r}"
            return result
        result["focused"] = True

        if not self.gui_open:
            result["error"] = (
                "Refusing slot click: no GUI tracked open (would hit world/pause). "
                "Open /cv menu first or mark_gui_open()."
            )
            result["aborted_pause_trap"] = True
            return result

        try:
            x, y = self.slot_screen_xy(slot, container_rows=container_rows)
            result["xy"] = [x, y]
            pyautogui.moveTo(x, y, duration=0.08)
            time.sleep(0.05)
            if pdi is not None:
                pdi.click(x=x, y=y, button=button, clicks=clicks)
            else:
                pyautogui.click(x=x, y=y, button=button, clicks=clicks)
            time.sleep(self.config.command_delay_ms / 1000.0)
            result["ok"] = True
            self.gui_open = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result

    def click_relative(self, rel_x: float, rel_y: float) -> dict:
        """Click at fractions of window size (0–1). Fallback when slot math is off."""
        result = {"ok": False, "xy": None, "error": None, "focused": False}
        if self.config.dry_run:
            result["ok"] = True
            return result
        if not self.focus_minecraft():
            result["error"] = f"No window matching title {self.config.window_title!r}"
            return result
        if PAUSE_FORBIDDEN_Y_MIN <= rel_y <= PAUSE_FORBIDDEN_Y_MAX and abs(rel_x - 0.5) < 0.15:
            result["error"] = (
                f"Refusing click at rel_y={rel_y:.2f} (Achievements/Statistics pause band)"
            )
            result["aborted_pause_trap"] = True
            return result
        result["focused"] = True
        win = self._find_window()
        assert win is not None
        x = int(win.left + win.width * rel_x)
        y = int(win.top + win.height * rel_y)
        result["xy"] = [x, y]
        try:
            pyautogui.moveTo(x, y, duration=0.08)
            if pdi is not None:
                pdi.click(x=x, y=y)
            else:
                pyautogui.click(x=x, y=y)
            time.sleep(self.config.command_delay_ms / 1000.0)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result

    def right_click(
        self,
        *,
        at_crosshair: bool = True,
        safe_capture: bool = False,
        sneak: bool = False,
        move_cursor: bool = False,
    ) -> dict:
        """Right-click to place/use at crosshair.

        NEVER left-clicks the aimed block (Daniel: digs with wrong hotbar).
        sneak=True holds Shift so chests/containers do not open (place against them).

        When the mouse is grabbed, do NOT moveTo — OS cursor motion rotates the
        camera and ruins server-tp'd aim. move_cursor=True only for ungrabbed/UI.
        """
        result = {
            "ok": False,
            "error": None,
            "xy": None,
            "capture_xy": None,
            "safe_capture_ignored": True,
            "sneak": sneak,
            "move_cursor": move_cursor,
        }
        if self.config.dry_run:
            result["ok"] = True
            return result
        self.release_mouse()
        if not self.focus_minecraft(click_to_focus=False):
            result["error"] = "no window"
            return result
        try:
            if sneak:
                if pdi is not None:
                    pdi.keyDown("shift")
                else:
                    pyautogui.keyDown("shift")
                time.sleep(0.05)
            if move_cursor and at_crosshair:
                win = self._find_window()
                if win is not None:
                    cx = int(win.left + win.width * 0.5)
                    cy = int(win.top + win.height * 0.5)
                    result["xy"] = [cx, cy]
                    pyautogui.moveTo(cx, cy, duration=0.05)
                    time.sleep(0.05)
            self.release_mouse()
            if pdi is not None:
                pdi.mouseDown(button="right")
                time.sleep(0.08)
                pdi.mouseUp(button="right")
            else:
                pyautogui.click(button="right")
            self.release_mouse()
            time.sleep(self.config.command_delay_ms / 1000.0)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
            self.release_mouse()
        finally:
            if sneak:
                try:
                    if pdi is not None:
                        pdi.keyUp("shift")
                    else:
                        pyautogui.keyUp("shift")
                except Exception:  # noqa: BLE001
                    pass
        return result

    def press_f2(self) -> dict:
        """Take a native Minecraft screenshot (writes under .minecraft/screenshots/)."""
        result = {"ok": False, "error": None}
        if self.config.dry_run:
            result["ok"] = True
            return result
        if not self.focus_minecraft():
            result["error"] = "no window"
            return result
        try:
            if pdi is not None:
                pdi.press("f2")
            else:
                pyautogui.press("f2")
            time.sleep(0.35)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result

    def select_hotbar(self, slot: int) -> dict:
        """Press hotbar key 1–9 (slot 0 → key '1', slot 8 → key '9'). HARD REQUIREMENT."""
        result = {"ok": False, "slot": slot, "key": None}
        if not (0 <= slot <= 8):
            result["error"] = "slot out of range"
            return result
        key = str(slot + 1)
        result["key"] = key
        if self.config.dry_run:
            result["ok"] = True
            return result
        self.release_mouse()
        if not self.focus_minecraft(click_to_focus=False):
            result["error"] = "no window"
            return result
        # DirectInput digit keys — do not use Numpad
        try:
            if pdi is not None:
                pdi.press(key)
            else:
                pyautogui.press(key)
            time.sleep(0.12)
            # Second press improves reliability when focus just changed
            if pdi is not None:
                pdi.press(key)
            else:
                pyautogui.press(key)
            time.sleep(0.12)
            result["ok"] = True
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result

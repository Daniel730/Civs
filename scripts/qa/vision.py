"""Lightweight vision for Civs QA — F2 native screenshots + heuristics (not NN).

Prefer Minecraft's F2 screenshot (exact client render) over pyautogui window
grabs. Reads newest PNG from %APPDATA%\\.minecraft\\screenshots\\, copies into
scripts/qa/reports/screenshots/, then classifies pause / container / world.
"""

from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore[assignment]


@dataclass
class VisionResult:
    kind: str  # world | container | pause | unknown
    confidence: float
    path: Optional[str] = None
    source_f2: Optional[str] = None
    notes: str = ""

    def is_safe_for_placement(self) -> bool:
        return self.kind == "world" and self.confidence >= 0.45


def minecraft_screenshot_dirs() -> list[Path]:
    """Candidate folders for native F2 screenshots (official first)."""
    appdata = os.environ.get("APPDATA") or ""
    home = Path.home()
    candidates = [
        Path(appdata) / ".minecraft" / "screenshots" if appdata else None,
        home / "AppData" / "Roaming" / ".minecraft" / "screenshots",
        home / ".minecraft" / "screenshots",
        Path(appdata) / ".tlauncher" / "legacy" / "Minecraft" / "game" / "screenshots"
        if appdata
        else None,
        home / ".tlauncher" / "legacy" / "Minecraft" / "game" / "screenshots",
    ]
    out: list[Path] = []
    seen: set[str] = set()
    for p in candidates:
        if p is None:
            continue
        key = str(p.resolve()) if p.exists() else str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def newest_screenshot(dirs: list[Path] | None = None) -> Optional[Path]:
    """Return newest .png across screenshot dirs, or None."""
    newest: Optional[Path] = None
    newest_mtime = -1.0
    for d in dirs or minecraft_screenshot_dirs():
        if not d.is_dir():
            continue
        for p in d.glob("*.png"):
            try:
                m = p.stat().st_mtime
            except OSError:
                continue
            if m > newest_mtime:
                newest_mtime = m
                newest = p
    return newest


def load_bgr(path: Path) -> Optional[np.ndarray]:
    if cv2 is not None:
        img = cv2.imread(str(path))
        return img
    try:
        from PIL import Image

        arr = np.array(Image.open(path).convert("RGB"))
        return arr[:, :, ::-1]
    except Exception:  # noqa: BLE001
        return None


def classify_frame(bgr: np.ndarray) -> VisionResult:
    """
    Heuristic classifier on a native (or grabbed) frame:

    - pause: darkened overlay + vertical stack of gray buttons
    - container: dark gray centered panel with slot-grid edges
    - world: otherwise
    """
    if bgr is None or bgr.size == 0:
        return VisionResult("unknown", 0.0, notes="empty frame")

    h, w = bgr.shape[:2]
    if h < 40 or w < 40:
        return VisionResult("unknown", 0.0, notes="tiny frame")

    y0, y1 = int(h * 0.18), int(h * 0.82)
    x0, x1 = int(w * 0.30), int(w * 0.70)
    center = bgr[y0:y1, x0:x1]
    gray = (
        cv2.cvtColor(center, cv2.COLOR_BGR2GRAY)
        if cv2 is not None
        else np.mean(center, axis=2).astype(np.uint8)
    )
    mean = float(np.mean(gray))
    std = float(np.std(gray))

    full_gray = (
        cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        if cv2 is not None
        else np.mean(bgr, axis=2).astype(np.uint8)
    )
    full_mean = float(np.mean(full_gray))
    world_detail = float(np.std(full_gray))

    if cv2 is not None:
        edges = cv2.Canny(gray, 60, 140)
        edge_density = float(np.mean(edges > 0))
    else:
        edge_density = 0.0

    strip = gray[:, max(0, gray.shape[1] // 2 - 8) : gray.shape[1] // 2 + 8]
    strip_1d = np.mean(strip, axis=1) if strip.size else np.array([0.0])
    if len(strip_1d) > 20:
        kernel = 5
        strip_s = np.convolve(strip_1d, np.ones(kernel) / kernel, mode="valid")
    else:
        strip_s = strip_1d
    button_rows = np.logical_and(strip_s > 85, strip_s < 175)
    transitions = int(np.sum(button_rows[1:] != button_rows[:-1])) if len(button_rows) > 1 else 0
    button_frac = float(np.mean(button_rows)) if len(button_rows) else 0.0

    # Pause = Game Menu button stack over a *blurred/dimmed* backdrop.
    # Bright sharp scenes (full_mean high, detail high) are gameplay — horizontal
    # block bands must NOT count as pause buttons (prior false positive).
    # Top-down (pitch 90) stone platforms also create button-like bands — require
    # low edge density (true menus blur the world behind buttons).
    likely_blurred_menu = full_mean < 110 and world_detail < 58 and edge_density < 0.045
    if likely_blurred_menu and transitions >= 6 and button_frac > 0.08:
        return VisionResult(
            "pause",
            min(0.98, 0.6 + transitions * 0.03),
            notes=(
                f"button_stack tr={transitions} btn_frac={button_frac:.2f} "
                f"full_mean={full_mean:.1f} detail={world_detail:.1f}"
            ),
        )
    if (
        likely_blurred_menu
        and transitions >= 4
        and button_frac > 0.10
        and edge_density < 0.22
    ):
        return VisionResult(
            "pause",
            min(0.95, 0.55 + transitions * 0.03),
            notes=(
                f"transitions={transitions} btn_frac={button_frac:.2f} "
                f"full_mean={full_mean:.1f} detail={world_detail:.1f} edges={edge_density:.3f}"
            ),
        )
    if full_mean < 35 and mean < 50 and std < 30 and world_detail < 28:
        return VisionResult(
            "pause",
            0.65,
            notes=f"dark_overlay full_mean={full_mean:.1f} mean={mean:.1f} detail={world_detail:.1f}",
        )

    # Container / chest GUI
    if 35 <= mean <= 110 and std < 48 and edge_density > 0.05:
        return VisionResult(
            "container",
            min(0.95, 0.5 + edge_density * 4),
            notes=f"mean={mean:.1f} std={std:.1f} edges={edge_density:.3f}",
        )

    conf = 0.55 if std > 25 or mean > 70 else 0.4
    # Very dark cave can be world with low confidence — still world if not pause/container
    if full_mean < 25 and world_detail < 20 and edge_density < 0.01:
        conf = 0.45  # dark world, still allow placement with override path
    return VisionResult(
        "world",
        conf,
        notes=f"mean={mean:.1f} std={std:.1f} edges={edge_density:.3f} tr={transitions}",
    )


def capture_f2(
    bot,
    *,
    out_dir: Path,
    label: str,
    timeout_s: float = 4.0,
) -> tuple[Optional[Path], Optional[Path], str]:
    """
    Press F2, wait for a new PNG in .minecraft/screenshots, copy into out_dir.

    Returns (copied_path, source_path, error_note).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    dirs = minecraft_screenshot_dirs()
    before = newest_screenshot(dirs)
    before_mtime = before.stat().st_mtime if before and before.exists() else 0.0

    bot.focus_minecraft()
    time.sleep(0.1)
    shot = bot.press_f2()
    if not shot.get("ok"):
        return None, None, f"f2_press_failed:{shot.get('error')}"

    deadline = time.time() + timeout_s
    source: Optional[Path] = None
    while time.time() < deadline:
        cand = newest_screenshot(dirs)
        if cand is not None and cand.exists():
            try:
                m = cand.stat().st_mtime
            except OSError:
                m = 0.0
            if m > before_mtime + 0.05:
                source = cand
                break
            # Same path rewritten
            if before is not None and cand.resolve() == before.resolve() and m > before_mtime:
                source = cand
                break
        time.sleep(0.15)

    if source is None:
        return None, None, f"no_new_f2_png under {[str(d) for d in dirs if d.exists()]}"

    ts = datetime.now(timezone.utc).strftime("%H%M%S")
    dest = out_dir / f"{label}_{ts}_f2.png"
    try:
        shutil.copy2(source, dest)
    except OSError as exc:
        return None, source, f"copy_failed:{exc}"
    return dest, source, ""


def capture_and_classify(
    bot,
    *,
    out_dir: Path,
    label: str,
    save: bool = True,
) -> VisionResult:
    """F2 native screenshot → classify. Falls back to note if F2 fails."""
    out_dir.mkdir(parents=True, exist_ok=True)
    copied, source, err = capture_f2(bot, out_dir=out_dir, label=label)
    if copied is None:
        return VisionResult("unknown", 0.0, notes=err or "f2 capture failed")

    bgr = load_bgr(copied)
    result = classify_frame(bgr) if bgr is not None else VisionResult("unknown", 0.0, notes="load failed")
    result.source_f2 = str(source) if source else None
    if save:
        # Rename copy to include classification kind
        ts = datetime.now(timezone.utc).strftime("%H%M%S")
        final = out_dir / f"{label}_{ts}_{result.kind}.png"
        try:
            if final.resolve() != copied.resolve():
                shutil.move(str(copied), str(final))
            result.path = str(final)
        except OSError:
            result.path = str(copied)
    else:
        result.path = str(copied)
    result.notes = (result.notes + f" | f2={source.name if source else '?'}" ).strip(" |")
    return result


def assert_world_view(bot, out_dir: Path, label: str) -> dict[str, Any]:
    """Return status dict; auto-dismiss pause/container up to twice, re-check via F2."""
    vis = capture_and_classify(bot, out_dir=out_dir, label=label, save=True)
    for attempt in range(2):
        if vis.kind == "pause":
            # Esc closes Game Menu when it is open (click dismiss is flaky).
            bot.press_escape(1)
            time.sleep(0.35)
            vis = capture_and_classify(
                bot, out_dir=out_dir, label=f"{label}_after_pause{attempt}", save=True
            )
            continue
        if vis.kind == "container":
            bot.ensure_menus_closed(force_esc=False)
            bot.press_escape(1)  # close chest/Civs GUI
            bot.mark_gui_open(False)
            time.sleep(0.35)
            vis = capture_and_classify(
                bot, out_dir=out_dir, label=f"{label}_after_esc{attempt}", save=True
            )
            continue
        break
    if vis.kind == "pause":
        bot.abort_if_pause_trap()
        time.sleep(0.35)
        vis = capture_and_classify(bot, out_dir=out_dir, label=f"{label}_esc_recover", save=True)
    return {
        "kind": vis.kind,
        "confidence": vis.confidence,
        "safe": vis.is_safe_for_placement(),
        "path": vis.path,
        "source_f2": vis.source_f2,
        "notes": vis.notes,
    }

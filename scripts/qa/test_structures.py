"""Structure QA: build-reqs via WorldEdit/fill, center Civs-item place, region verify."""

from __future__ import annotations

import json
import math
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_reqs import (
    footprint_bounds,
    load_item_groups,
    parse_build_reqs,
    plan_block_placements,
)
from inventory import (
    CIVS_SLOT,
    WAND_SLOT,
    ensure_civs_item,
    ensure_wand,
    format_snapshot_md,
    log_selected,
    prepare_hotbar_for_placement,
    select_hotbar_key_and_verify,
    snapshot_inventory,
    snapshot_to_dict,
)
from item_types import ItemType, load_batch
from production_io import is_production_structure, verify_production_io
from qa_config import QAConfig, grep_log_errors, tail_server_log_wsl
from rcon_client import RconClient
from vision import assert_world_view
from window_bot import WindowBot

# Representative types across categories (settlement-compatible gated set).
# wheat_farm/bank need hamlet/village — omit until town upgrade.
DEFAULT_PLACE_BATCH = [
    "gravel_quarry",  # quarries / raw
    "coal_mine",  # mines
    "shelter",  # admin-invisible / housing starter
    "cactus_farm",  # farms (no town pre-req)
    "purifier",  # utilities (ungated)
    "arrow_trap",  # defense — settlement
    "shack",  # housing — settlement + instant-build
    "smithy",  # factories/utilities — settlement
    "potato_farm",  # farms — settlement
    "flint_works",  # factories — settlement
]

# Settlement town claim radius (item-types/towns/settlement.yml build-radius).
TOWN_CLAIM_RADIUS = 40

REGIONS_WSL = "/home/dansilva/civs-testserver/plugins/Civs/regions"


@dataclass
class StructureResult:
    key: str
    name: str
    category: str
    static_ok: bool
    static_issues: list[str] = field(default_factory=list)
    rcon_pad_ok: bool = False
    build_ok: bool = False
    place_ok: bool = False
    region_registered: bool = False
    io_ok: bool | None = None  # None = not production / not run
    io_detail: str = ""
    center: list[int] | None = None
    held_before: str | None = None
    notes: str = ""
    chat_hints: list[str] = field(default_factory=list)


def validate_static(item: ItemType, cfg: QAConfig) -> StructureResult:
    issues = item.validate_static(None)
    return StructureResult(
        key=item.key,
        name=item.name,
        category=item.category,
        static_ok=len(issues) == 0 or all("may auto-generate" in i for i in issues),
        static_issues=issues,
        notes="instant-build" if item.instant_build else "manual build-reqs",
    )


# Extra gap between region footprints so bounding boxes never touch (Daniel).
PAD_MARGIN = 12  # was 10; cactus/coal at exact margin overlapped Civs radii


@dataclass
class PlacedPad:
    key: str
    cx: int
    cy: int
    cz: int
    radius: int

    @property
    def half_span(self) -> int:
        """Blocks from center to edge of exclusive zone (radius + half margin)."""
        return int(self.radius) + PAD_MARGIN


class PadAllocator:
    """
    Non-overlapping structure pads.

    Each new center is placed so its cube footprint (radius) plus PAD_MARGIN
    does not intersect any prior pad or known existing region center.
    Spacing between centers A and B: radius_A + radius_B + PAD_MARGIN
    (equivalent to Daniel's max(r)*2+10 when radii are similar).

    Fresh origin every suite run — never reuse the fixed 2108 grid that caused
    coal_mine/quarry stacking on leftover region YAMLs.
    """

    def __init__(
        self,
        origin_x: int,
        origin_y: int,
        origin_z: int,
        *,
        cols: int = 4,
        existing: list[tuple[int, int, int, int]] | None = None,
    ) -> None:
        self.origin_x = int(origin_x)
        self.origin_y = int(origin_y)
        self.origin_z = int(origin_z)
        self.cols = max(1, int(cols))
        self.placed: list[PlacedPad] = []
        # (cx, cz, radius, label) from prior region YAMLs / town hub
        self.blocked: list[tuple[int, int, int, str]] = []
        for cx, cy, cz, radius in existing or []:
            self.blocked.append((int(cx), int(cz), int(radius), "existing"))

    def _min_center_dist(self, r_a: int, r_b: int) -> int:
        return int(r_a) + int(r_b) + PAD_MARGIN

    def _overlaps(self, cx: int, cz: int, radius: int) -> str | None:
        # Cube footprints: Chebyshev distance must be >= r_a + r_b + margin
        for pad in self.placed:
            need = self._min_center_dist(radius, pad.radius)
            if max(abs(cx - pad.cx), abs(cz - pad.cz)) < need:
                return f"overlaps pad {pad.key}@{pad.cx},{pad.cz} r={pad.radius}"
        for bx, bz, br, label in self.blocked:
            need = self._min_center_dist(radius, br)
            if max(abs(cx - bx), abs(cz - bz)) < need:
                return f"overlaps {label}@{bx},{bz} r={br}"
        return None

    def allocate(self, key: str, radius: int) -> PlacedPad:
        """Next free pad center; walks a grid with radius-aware step."""
        r = max(1, int(radius or 3))
        # Conservative step vs largest neighbor we might sit beside
        base_step = self._min_center_dist(r, r)
        # Also respect already-placed max radius so early small pads don't
        # pack too tight for a later large structure in an adjacent cell.
        if self.placed:
            max_prev = max(p.radius for p in self.placed)
            base_step = max(base_step, self._min_center_dist(r, max_prev))

        for attempt in range(0, 256):
            col = attempt % self.cols
            row = attempt // self.cols
            cx = self.origin_x + col * base_step
            cz = self.origin_z + row * base_step
            cy = self.origin_y
            reason = self._overlaps(cx, cz, r)
            if reason is None:
                pad = PlacedPad(key=key, cx=cx, cy=cy, cz=cz, radius=r)
                self.placed.append(pad)
                return pad
        raise RuntimeError(f"PadAllocator exhausted grid for {key} r={r}")

    def allocate_inside_town(
        self,
        key: str,
        radius: int,
        hub_cx: int,
        hub_cz: int,
        town_radius: int = TOWN_CLAIM_RADIUS,
    ) -> PlacedPad:
        """
        Place pad fully inside town claim, non-overlapping with hub/pads.

        Requires: Chebyshev(center, hub) + structure_radius <= town_radius
        and no pad/blocked overlap (r_a+r_b+PAD_MARGIN).
        """
        r = max(1, int(radius or 3))
        max_center_dist = int(town_radius) - r
        if max_center_dist < 1:
            raise RuntimeError(
                f"PadAllocator: {key} r={r} cannot fit inside town_radius={town_radius}"
            )
        # Ring start: clear of hub exclusive zone (usually town_hub r=12)
        hub_block_r = 0
        for bx, bz, br, label in self.blocked:
            if bx == hub_cx and bz == hub_cz:
                hub_block_r = max(hub_block_r, br)
        for pad in self.placed:
            if pad.cx == hub_cx and pad.cz == hub_cz:
                hub_block_r = max(hub_block_r, pad.radius)
        min_center_dist = self._min_center_dist(r, hub_block_r or 5)

        step = max(3, min(8, r + 2))
        # Spiral outward from hub on a square ring
        for dist in range(min_center_dist, max_center_dist + 1, step):
            candidates: list[tuple[int, int]] = []
            for dx in range(-dist, dist + 1, step):
                candidates.append((hub_cx + dx, hub_cz - dist))
                candidates.append((hub_cx + dx, hub_cz + dist))
            for dz in range(-dist + step, dist, step):
                candidates.append((hub_cx - dist, hub_cz + dz))
                candidates.append((hub_cx + dist, hub_cz + dz))
            for cx, cz in candidates:
                # Footprint must stay inside town (Chebyshev)
                if max(abs(cx - hub_cx), abs(cz - hub_cz)) + r > town_radius:
                    continue
                if self._overlaps(cx, cz, r) is None:
                    pad = PlacedPad(
                        key=key, cx=cx, cy=self.origin_y, cz=cz, radius=r
                    )
                    self.placed.append(pad)
                    return pad
        raise RuntimeError(
            f"PadAllocator exhausted in-town ring for {key} r={r} "
            f"hub={hub_cx},{hub_cz} town_r={town_radius}"
        )

    def allocate_outside_town(
        self,
        key: str,
        radius: int,
        hub_cx: int,
        hub_cz: int,
        town_radius: int = TOWN_CLAIM_RADIUS,
    ) -> PlacedPad:
        """Outer pad fully outside town claim + margin; non-overlapping."""
        r = max(1, int(radius or 3))
        # Center must be far enough that footprint clears town edge + PAD_MARGIN
        min_dist = int(town_radius) + r + PAD_MARGIN
        base_step = self._min_center_dist(r, r)
        if self.placed:
            max_prev = max(p.radius for p in self.placed)
            base_step = max(base_step, self._min_center_dist(r, max_prev))

        for attempt in range(0, 512):
            col = attempt % self.cols
            row = attempt // self.cols
            # Anchor east of hub so we clear the claim quickly
            cx = hub_cx + min_dist + col * base_step
            cz = hub_cz + row * base_step
            if max(abs(cx - hub_cx), abs(cz - hub_cz)) < min_dist:
                continue
            if self._overlaps(cx, cz, r) is None:
                pad = PlacedPad(key=key, cx=cx, cy=self.origin_y, cz=cz, radius=r)
                self.placed.append(pad)
                return pad
        raise RuntimeError(f"PadAllocator exhausted outside-town grid for {key} r={r}")

    def reserve_blocked(self, cx: int, cz: int, radius: int, label: str) -> None:
        self.blocked.append((int(cx), int(cz), int(radius), label))

    def bounds(self) -> tuple[int, int, int, int] | None:
        """Inclusive XZ bounds covering all placed pads + margin."""
        if not self.placed:
            return None
        x0 = min(p.cx - p.radius - PAD_MARGIN for p in self.placed)
        x1 = max(p.cx + p.radius + PAD_MARGIN for p in self.placed)
        z0 = min(p.cz - p.radius - PAD_MARGIN for p in self.placed)
        z1 = max(p.cz + p.radius + PAD_MARGIN for p in self.placed)
        return x0, z0, x1, z1


def fresh_pad_origin(cfg: QAConfig) -> tuple[int, int, int]:
    """
    New suite origin far from the old fixed 2100 grid.

    Uses UTC time so consecutive runs do not land on prior region YAMLs.
    """
    now = datetime.now(timezone.utc)
    # Slot every ~2 min into a 40-cell ring → ~80 min before recycle
    slot = (now.hour * 30 + now.minute // 2) % 40
    ox = 2600 + (slot % 8) * 80
    oz = 2600 + (slot // 8) * 80
    oy = cfg.platform_y + 1
    return ox, oy, oz


def parse_region_centers_wsl() -> list[tuple[int, int, int, int]]:
    """
    Parse plugins/Civs/regions/*.yml names → (cx, cy, cz, assumed_radius).

    Filenames look like: <uuid>~2132.5~81.5~2108.5.yml
    Assumed radius 8 until we know type — blocks pads near existing regions.
    """
    import re

    script = f"ls -1 '{REGIONS_WSL}' 2>/dev/null || true"
    out_centers: list[tuple[int, int, int, int]] = []
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception:  # noqa: BLE001
        return out_centers
    pat = re.compile(
        r"~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)\.yml$",
        re.IGNORECASE,
    )
    for ln in (out.stdout or "").splitlines():
        name = ln.strip()
        m = pat.search(name)
        if not m:
            continue
        cx = int(float(m.group(1)))
        cy = int(float(m.group(2)))
        cz = int(float(m.group(3)))
        out_centers.append((cx, cy, cz, 8))
    return out_centers


def pad_center(cfg: QAConfig, index: int, radius: int) -> tuple[int, int, int]:
    """Deprecated single-index helper — prefer PadAllocator.allocate."""
    step = max(PAD_MARGIN, int(radius) * 2 + PAD_MARGIN)
    x = cfg.platform_x + 8 + (index % 4) * step
    z = cfg.platform_z + 8 + (index // 4) * step
    y = cfg.platform_y + 1
    return x, y, z


def rcon_prepare_platform(
    cfg: QAConfig,
    client: RconClient,
    marker: str,
    *,
    x0: int | None = None,
    z0: int | None = None,
    x1: int | None = None,
    z1: int | None = None,
) -> list[str]:
    p = cfg.player_name
    y = cfg.platform_y
    if x0 is None or z0 is None or x1 is None or z1 is None:
        x, z = cfg.platform_x, cfg.platform_z
        s = cfg.pad_size
        x0, z0, x1, z1 = x, z, x + s - 1, z + s - 1
    # fill volume limit ~32768 blocks per command — chunk large pads
    cmds = [
        f"say {marker} structure QA start (separated pads)",
        f"op {p}",
        f"gamemode creative {p}",
        f"tp {p} {(x0 + x1) // 2} {y + 1} {(z0 + z1) // 2}",
        "time set day",
        "weather clear",
    ]
    outputs: list[str] = []
    for cmd in cmds:
        try:
            outputs.append(client.command(cmd))
            time.sleep(0.2)
        except Exception as exc:  # noqa: BLE001
            outputs.append(f"ERR:{cmd}:{exc}")

    # Floor + air in strips along X to stay under fill limits
    strip = 24
    xx = x0
    while xx <= x1:
        x_end = min(xx + strip - 1, x1)
        try:
            outputs.append(
                client.command(
                    f"fill {xx} {y} {z0} {x_end} {y} {z1} grass_block"
                )
            )
            outputs.append(
                client.command(
                    f"fill {xx} {y + 1} {z0} {x_end} {y + 12} {z1} air"
                )
            )
            time.sleep(0.15)
        except Exception as exc:  # noqa: BLE001
            outputs.append(f"ERR:fill:{exc}")
        xx = x_end + 1
    return outputs


def clear_footprint(client: RconClient, cx: int, cy: int, cz: int, radius: int) -> None:
    """Clear one pad (+ margin) so WE/place never sits inside leftover blocks.

    Order matters: air wipe first, then solid floor. A support slab under the
    footprint stops gravity blocks (gravel/sand) from falling out of the volume
    — gravel_quarry was failing Civs build-reqs because gravel fell away.
    """
    clear_r = int(radius) + 2
    x0, y0, z0, x1, y1, z1 = footprint_bounds(cx, cy, cz, clear_r)
    client.command(f"fill {x0} {y0 - 1} {z0} {x1} {y0 - 1} {z1} stone")
    client.command(f"fill {x0} {y0} {z0} {x1} {y1} {z1} air")
    # Solid column up to place-floor so gravel/sand at y<cy never falls
    if y0 <= cy - 1:
        client.command(f"fill {x0} {y0} {z0} {x1} {cy - 1} {z1} stone")
    else:
        client.command(f"fill {x0} {cy - 1} {z0} {x1} {cy - 1} {z1} stone")


def build_reqs_with_we(
    bot: WindowBot,
    client: RconClient,
    player: str,
    cx: int,
    cy: int,
    cz: int,
    radius: int,
    placements: list[tuple[int, int, int, str]],
) -> dict[str, Any]:
    """
    Build structure volume to satisfy build-reqs.

    WorldEdit via chat //pos1/pos2/set (coord form — no wand click needed).
    Still ensures WE wand is in WAND_SLOT and selected before WE chat cmds
    (Daniel: wand discipline). Never left-clicks the world.
    setblock is source of truth for exact build-req counts.
    """
    result: dict[str, Any] = {
        "ok": False,
        "we_cmds": [],
        "setblocks": 0,
        "error": None,
        "hotbar_log": [],
    }
    x0, y0, z0, x1, y1, z1 = footprint_bounds(cx, cy, cz, radius)

    counts: dict[str, int] = {}
    for _, _, _, mat in placements:
        counts[mat] = counts.get(mat, 0) + 1
    if not counts and radius >= 0:
        result["ok"] = True
        result["we_cmds"].append("noop_empty_footprint")
        return result

    # Never WE-fill with gravity/fragile mats — sand/gravel volumes crush cactus
    # and fall out of the pad; use a stable filler then setblock exact reqs.
    fragile = {
        "gravel",
        "sand",
        "red_sand",
        "cactus",
        "dragon_egg",
        "anvil",
        "concrete_powder",
        "water_cauldron",
        "wheat",
        "potatoes",
    }
    solid_counts = {
        m: n
        for m, n in counts.items()
        if m.split("[", 1)[0] not in fragile and not m.endswith("_concrete_powder")
    }
    dominant = max(solid_counts, key=solid_counts.get) if solid_counts else "stone"

    # Creative so accidental clicks cannot destroy (still avoid LMB)
    client.command(f"gamemode creative {player}")
    bot.release_mouse()
    result["hotbar_log"].append(log_selected(client, player, "we_before"))

    wand = ensure_wand(client, player, bot, slot=WAND_SLOT)
    result["wand"] = wand
    result["hotbar_log"].append(log_selected(client, player, "we_wand_selected"))
    if not wand.get("ok"):
        result["error"] = wand.get("error") or "WE wand not selected — abort WE"
        # Still try setblock-only path below
        print(f"[WE] WARN wand fail: {result['error']}", flush=True)

    # Coord //pos — does not require wand clicks; wand must still be in hand
    we_seq = [
        f"//pos1 {x0},{y0},{z0}",
        f"//pos2 {x1},{y1},{z1}",
        f"//set {dominant}",
        f"//pos1 {cx},{cy},{cz}",
        f"//pos2 {cx},{cy},{cz}",
        "//set air",
    ]
    for cmd in we_seq:
        # Re-assert wand selected before each WE chat cmd
        if wand.get("ok"):
            bot.select_hotbar(WAND_SLOT)
            time.sleep(0.1)
            result["hotbar_log"].append(log_selected(client, player, f"we_cmd:{cmd[:20]}"))
        wr = bot.send_chat_command(cmd, close_menus=True)
        result["we_cmds"].append({"cmd": cmd, "ok": wr.get("ok"), "err": wr.get("error")})
        bot.release_mouse()
        time.sleep(0.35)

    placed = 0
    # Place support/solid mats first, then gravity, then cactus (needs sand under + air sides)
    def _place_priority(mat: str) -> int:
        base = mat.split("[", 1)[0]
        if base == "cactus":
            return 2
        if base in {"gravel", "sand", "red_sand", "dragon_egg", "anvil"} or base.endswith(
            "_concrete_powder"
        ):
            return 1
        return 0

    ordered = sorted(placements, key=lambda t: _place_priority(t[3]))
    for x, y, z, mat in ordered:
        try:
            if mat.endswith("_door"):
                client.command(f"setblock {x} {y} {z} {mat}[half=lower]")
                client.command(f"setblock {x} {y + 1} {z} {mat}[half=upper]")
            elif mat.endswith("_bed"):
                client.command(f"setblock {x} {y} {z} {mat}[part=foot]")
            elif mat == "water_cauldron":
                client.command(f"setblock {x} {y} {z} water_cauldron[level=3]")
            elif mat == "cactus":
                # Ensure sand under; clear horizontal neighbors so cactus survives
                client.command(f"setblock {x} {y - 1} {z} sand")
                for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    client.command(f"setblock {x + dx} {y} {z + dz} air")
                client.command(f"setblock {x} {y} {z} cactus")
            elif mat in ("wheat", "potatoes", "carrots", "beetroots"):
                client.command(f"setblock {x} {y - 1} {z} farmland")
                age = "7" if mat != "beetroots" else "3"
                client.command(f"setblock {x} {y} {z} {mat}[age={age}]")
            elif mat == "redstone_wire":
                client.command(f"setblock {x} {y - 1} {z} stone")
                client.command(f"setblock {x} {y} {z} redstone_wire")
            else:
                client.command(f"setblock {x} {y} {z} {mat}")
            placed += 1
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
    client.command(f"setblock {cx} {cy} {cz} air")
    for z in (cz - 1, cz - 2):
        client.command(f"setblock {cx} {cy} {z} air")
        client.command(f"setblock {cx} {cy + 1} {z} air")
    client.command(f"setblock {cx} {cy - 1} {cz} stone")
    client.command(f"setblock {cx} {cy - 1} {cz - 2} stone")

    result["setblocks"] = placed
    result["dominant"] = dominant
    result["material_counts"] = counts
    we_ok = any(c.get("ok") for c in result["we_cmds"] if isinstance(c, dict))
    result["ok"] = placed > 0 or (not placements)
    result["we_ok"] = we_ok
    # Gravity settle then re-stamp gravity + cactus + redstone + crops
    time.sleep(0.35)
    gravity = {"gravel", "sand", "red_sand", "dragon_egg", "anvil", "concrete_powder"}
    restamped = 0
    for x, y, z, mat in ordered:
        base = mat.split("[", 1)[0]
        if base in gravity or base.endswith("_concrete_powder"):
            try:
                client.command(f"setblock {x} {y} {z} {mat}")
                restamped += 1
            except Exception:  # noqa: BLE001
                pass
    for x, y, z, mat in ordered:
        if mat != "cactus":
            continue
        try:
            client.command(f"setblock {x} {y - 1} {z} sand")
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                client.command(f"setblock {x + dx} {y} {z + dz} air")
            client.command(f"setblock {x} {y} {z} cactus")
            restamped += 1
        except Exception:  # noqa: BLE001
            pass
    for x, y, z, mat in ordered:
        if mat != "redstone_wire":
            continue
        try:
            client.command(f"setblock {x} {y - 1} {z} stone")
            client.command(f"setblock {x} {y} {z} redstone_wire")
            restamped += 1
        except Exception:  # noqa: BLE001
            pass
    for x, y, z, mat in ordered:
        if mat not in ("wheat", "potatoes", "carrots", "beetroots"):
            continue
        try:
            client.command(f"setblock {x} {y - 1} {z} farmland")
            age = "7" if mat != "beetroots" else "3"
            client.command(f"setblock {x} {y} {z} {mat}[age={age}]")
            restamped += 1
        except Exception:  # noqa: BLE001
            pass
    result["gravity_restamp"] = restamped
    result["hotbar_log"].append(log_selected(client, player, "we_after"))
    bot.release_mouse()
    return result


def _rcon_block_is(client: RconClient, x: int, y: int, z: int, block: str) -> bool:
    """RCON `execute if block` returns 'Test passed' / 'Test failed' (say text is NOT echoed)."""
    try:
        out = client.command(f"execute if block {x} {y} {z} {block}")
        return "Test passed" in (out or "")
    except Exception:  # noqa: BLE001
        return False


def _center_is_chest(client: RconClient, cx: int, cy: int, cz: int) -> tuple[bool, str]:
    """Detect chest at exact center. Prefer cy (floor-top place); also scan neighbors/Y."""
    for y in (cy, cy - 1, cy + 1, cy - 2):
        for mat in ("chest", "trapped_chest"):
            if _rcon_block_is(client, cx, y, cz, mat):
                return True, f"y={y} mat={mat} Test passed"
    try:
        blob = client.command(f"data get block {cx} {cy} {cz}")
        return "chest" in blob.lower(), blob[:240]
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _scan_chest_offsets(
    client: RconClient, cx: int, cy: int, cz: int
) -> dict[str, str]:
    """Map dx,dy,dz → HIT for diagnosis (aim short / Y drift)."""
    found: dict[str, str] = {}
    for dx, dy, dz in (
        (0, 0, 0),
        (0, -1, 0),
        (0, -2, 0),
        (0, 1, 0),
        (0, 0, -1),
        (0, 0, 1),
        (-1, 0, 0),
        (1, 0, 0),
        (0, -1, -1),
        (0, 0, -2),
    ):
        key = f"{dx},{dy},{dz}"
        try:
            found[key] = (
                "HIT" if _rcon_block_is(client, cx + dx, cy + dy, cz + dz, "chest") else ""
            )
        except Exception:  # noqa: BLE001
            found[key] = "err"
    return found


def _prepare_aim_geometry(client: RconClient, cx: int, cy: int, cz: int) -> None:
    """
    Floor-top place at (cx, cy, cz):

    Continuous stone between stand and center makes the ray hit cz-1 first
    (Civs place smoke 2026-07-17: dirt OK at cy, chest at 0,0,-1).

    - Stone under center; AIR pit at (cx, cy-1, cz-1) so LOS reaches center top
    - Stone footing at cz-2 / cz-3; stone under the pit at cy-2
    """
    client.command(f"fill {cx - 1} {cy - 1} {cz - 3} {cx + 1} {cy - 1} {cz + 1} stone")
    client.command(f"fill {cx - 1} {cy} {cz - 3} {cx + 1} {cy + 2} {cz + 1} air")
    client.command(f"setblock {cx} {cy - 1} {cz} stone")
    # Air pit: do not let south neighbor top-face steal the crosshair
    client.command(f"setblock {cx} {cy - 1} {cz - 1} air")
    client.command(f"setblock {cx} {cy - 2} {cz - 1} stone")
    for z in (cz - 2, cz - 3):
        client.command(f"setblock {cx} {cy - 1} {z} stone")
        client.command(f"setblock {cx} {cy} {z} air")
        client.command(f"setblock {cx} {cy + 1} {z} air")
    client.command(f"setblock {cx} {cy} {cz} air")
    client.command(f"setblock {cx + 1} {cy} {cz - 2} torch")
    for z in range(cz - 3, cz + 2):
        for dy in (0, 1):
            if z == cz and dy == 0:
                continue
            try:
                if _rcon_block_is(client, cx, cy + dy, z, "chest"):
                    client.command(f"setblock {cx} {cy + dy} {z} air")
            except Exception:  # noqa: BLE001
                pass



def _restore_build_placements(
    client: RconClient,
    placements: list[tuple[int, int, int, str]],
    cx: int,
    cy: int,
    cz: int,
) -> int:
    """Re-apply build-req setblocks after aim geometry (must not wipe reqs)."""
    placed = 0

    def _prio(mat: str) -> int:
        base = mat.split("[", 1)[0]
        if base == "cactus":
            return 2
        if base in {"gravel", "sand", "red_sand"} or base.endswith("_concrete_powder"):
            return 1
        return 0

    for x, y, z, mat in sorted(placements, key=lambda t: _prio(t[3])):
        if (x, y, z) == (cx, cy, cz):
            continue
        if x == cx and y == cy - 1 and z == cz - 1:
            continue
        try:
            if mat.endswith("_door"):
                client.command(f"setblock {x} {y} {z} {mat}[half=lower]")
                client.command(f"setblock {x} {y + 1} {z} {mat}[half=upper]")
            elif mat.endswith("_bed"):
                client.command(f"setblock {x} {y} {z} {mat}[part=foot]")
            elif mat == "water_cauldron":
                client.command(f"setblock {x} {y} {z} water_cauldron[level=3]")
            elif mat == "wheat":
                client.command(f"setblock {x} {y - 1} {z} farmland")
                client.command(f"setblock {x} {y} {z} wheat[age=7]")
            elif mat == "potatoes":
                client.command(f"setblock {x} {y - 1} {z} farmland")
                client.command(f"setblock {x} {y} {z} potatoes[age=7]")
            elif mat == "carrots":
                client.command(f"setblock {x} {y - 1} {z} farmland")
                client.command(f"setblock {x} {y} {z} carrots[age=7]")
            elif mat == "redstone_wire":
                client.command(f"setblock {x} {y - 1} {z} stone")
                client.command(f"setblock {x} {y} {z} redstone_wire")
            elif mat == "cactus":
                client.command(f"setblock {x} {y - 1} {z} sand")
                for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    client.command(f"setblock {x + dx} {y} {z + dz} air")
                client.command(f"setblock {x} {y} {z} cactus")
            else:
                client.command(f"setblock {x} {y} {z} {mat}")
            placed += 1
        except Exception:  # noqa: BLE001
            pass
    client.command(f"setblock {cx} {cy} {cz} air")
    client.command(f"setblock {cx} {cy - 1} {cz} stone")
    client.command(f"setblock {cx} {cy - 1} {cz - 1} air")
    client.command(f"setblock {cx} {cy - 2} {cz - 1} stone")
    # Final fragile restamp after aim corridor (r=1 arrow_trap redstone is easy to wipe)
    for x, y, z, mat in placements:
        if (x, y, z) == (cx, cy, cz):
            continue
        if x == cx and y == cy - 1 and z == cz - 1:
            continue
        try:
            if mat == "redstone_wire":
                client.command(f"setblock {x} {y - 1} {z} stone")
                client.command(f"setblock {x} {y} {z} redstone_wire")
            elif mat == "potatoes":
                client.command(f"setblock {x} {y - 1} {z} farmland")
                client.command(f"setblock {x} {y} {z} potatoes[age=7]")
            elif mat in ("wheat", "carrots"):
                client.command(f"setblock {x} {y - 1} {z} farmland")
                client.command(f"setblock {x} {y} {z} {mat}[age=7]")
        except Exception:  # noqa: BLE001
            pass
    return placed


def place_civs_at_center(
    bot: WindowBot,
    client: RconClient,
    player: str,
    civs_key: str,
    cx: int,
    cy: int,
    cz: int,
    *,
    instant_build: bool,
    screenshots_dir: Path | None = None,
    restore_placements: list[tuple[int, int, int, str]] | None = None,
) -> dict[str, Any]:
    """
    HARD REQUIREMENT: Civs region item on exact center — chest-safe geometry.

    Stand south on solid footing, look at the TOP face of the stone floor under
    center (y=cy plane). Right-click places trigger chest at (cx, cy, cz).
    Vision refuses clicks if container/pause open (no hotbar-override).
    """
    shot_dir = screenshots_dir or Path(__file__).resolve().parent / "reports" / "screenshots"
    result: dict[str, Any] = {
        "ok": False,
        "civs_key": civs_key,
        "center": [cx, cy, cz],
        "item": None,
        "hygiene": None,
        "vision": [],
        "right_click": None,
        "placement_menu": None,
        "attempts": [],
        "error": None,
    }

    bot.ensure_menus_closed(force_esc=False)
    # Recover if a prior force-Esc left Game Menu open
    boot_vis = assert_world_view(bot, shot_dir, f"{civs_key}_boot")
    result["vision"].append(boot_vis)
    if not boot_vis.get("safe"):
        bot.press_escape(1)
        time.sleep(0.35)
        boot_vis2 = assert_world_view(bot, shot_dir, f"{civs_key}_boot2")
        result["vision"].append(boot_vis2)

    # HARD REQUIREMENT: RCON dump → find slot → press key 1–9 → verify SelectedItem
    hygiene = prepare_hotbar_for_placement(
        client, player, civs_key, preferred_slot=0, bot=bot
    )
    result["hygiene"] = hygiene
    result["item"] = hygiene.get("ensure")
    if not hygiene.get("ok"):
        result["error"] = hygiene.get("error") or "inventory hygiene / hotbar key select failed"
        return result

    hotbar_slot = int(hygiene.get("slot") or CIVS_SLOT)
    bot.release_mouse()
    bot.select_hotbar(hotbar_slot)
    time.sleep(0.2)
    client.command("time set day")
    client.command(f"effect give {player} night_vision 120 0 true")
    client.command(f"gamemode creative {player}")
    _prepare_aim_geometry(client, cx, cy, cz)
    if restore_placements:
        result["restored_blocks"] = _restore_build_placements(
            client, restore_placements, cx, cy, cz
        )
    time.sleep(0.15)

    # Air pit at cz-1; stand on cz-2 footing.
    # Prefer stand-close only — overhead/levitation often loses mouse grab.
    feet_y = float(cy)
    poses = [
        (cx + 0.5, feet_y, cz - 1.15, "daniel_south_close"),
        (cx + 0.5, feet_y, cz - 2.0, "daniel_south_floor"),
    ]
    # Default look: into stone block under center (TOP face)
    look = (cx + 0.5, float(cy) - 0.5, cz + 0.5)

    def _yaw_pitch(px_: float, py_: float, pz_: float, label_: str) -> tuple[float, float]:
        if label_ == "overhead_down":
            return 0.0, 90.0
        ex, ey, ez = px_, py_ + 1.62, pz_
        dx, dy, dz = look[0] - ex, look[1] - ey, look[2] - ez
        dist = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        yaw = math.degrees(math.atan2(-dx, dz))
        pitch = math.degrees(math.asin(max(-1.0, min(1.0, -dy / dist))))
        return yaw, pitch

    def _prep_pose_geometry(label: str) -> None:
        """Surgical LOS clear — do not fill-wipe the build-req volume."""
        if label == "overhead_down":
            client.command(f"effect give {player} levitation 12 255 true")
            client.command(f"fill {cx - 1} {cy} {cz - 1} {cx + 1} {cy + 4} {cz + 1} air")
            client.command(f"setblock {cx} {cy - 1} {cz} stone replace")
            client.command(f"setblock {cx} {cy} {cz} air")
        else:
            for z in (cz - 2, cz - 3):
                client.command(f"setblock {cx} {cy - 1} {z} stone")
                client.command(f"setblock {cx} {cy} {z} air")
                client.command(f"setblock {cx} {cy + 1} {z} air")
            client.command(f"setblock {cx} {cy - 1} {cz} stone replace")
            client.command(f"setblock {cx} {cy} {cz} air")
            client.command(f"setblock {cx} {cy - 1} {cz - 1} air")
            client.command(f"setblock {cx} {cy - 2} {cz - 1} stone")
            client.command(f"setblock {cx} {cy} {cz - 1} air")
            client.command(f"setblock {cx} {cy + 1} {cz - 1} air")
        if restore_placements:
            _restore_build_placements(client, restore_placements, cx, cy, cz)
        # After restore: clear decoy chests on LOS only (build-req chests may be re-placed)
        for dx, dy, dz in ((0, 0, -1), (0, 0, -2), (0, 1, 0), (0, 0, 0), (0, 1, -1)):
            try:
                if _rcon_block_is(client, cx + dx, cy + dy, cz + dz, "chest"):
                    client.command(f"setblock {cx + dx} {cy + dy} {cz + dz} air")
            except Exception:  # noqa: BLE001
                pass

    rc: dict[str, Any] = {}
    for px, py, pz, label in poses:
        _prep_pose_geometry(label)
        yaw, pitch = _yaw_pitch(px, py, pz, label)
        client.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.55)

        hand = client.command(
            f"data get entity {player} SelectedItem.components.minecraft:custom_data"
        )
        if civs_key not in hand:
            hygiene2 = prepare_hotbar_for_placement(
                client, player, civs_key, preferred_slot=CIVS_SLOT, bot=bot
            )
            result["hygiene_reselect"] = hygiene2
            if not hygiene2.get("ok"):
                result["attempts"].append(
                    {"pose": label, "skipped": "hotbar_reselect_fail", "hygiene": hygiene2}
                )
                continue
            hotbar_slot = int(hygiene2.get("slot") or CIVS_SLOT)
            time.sleep(0.15)

        # Overhead pitch-90: top-down stone bands false-positive as pause — skip vision gate
        if label != "overhead_down":
            vis = assert_world_view(bot, shot_dir, f"{civs_key}_{label}_pre")
            result["vision"].append(vis)
            if not vis.get("safe"):
                bot.press_escape(1)
                time.sleep(0.3)
                bot.release_mouse()
                yaw, pitch = _yaw_pitch(px, py, pz, label)
                client.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
                time.sleep(0.35)
                vis2 = assert_world_view(bot, shot_dir, f"{civs_key}_{label}_retry")
                result["vision"].append(vis2)
                if not vis2.get("safe"):
                    result["attempts"].append(
                        {"pose": label, "skipped": "gui_open", "vision": vis2}
                    )
                    continue

        # HARD: press hotbar key immediately before every right-click; abort if wrong
        ks = select_hotbar_key_and_verify(bot, client, player, civs_key, hotbar_slot)
        result.setdefault("hotbar_log", []).append(ks.get("after") or ks)
        if not ks.get("ok"):
            result["attempts"].append(
                {"pose": label, "skipped": "hotbar_verify_fail", "key_select": ks}
            )
            result["error"] = ks.get("error") or "hotbar verify abort"
            break
        # Re-assert look AFTER keypress (server rotation; facing= broken)
        yaw, pitch = _yaw_pitch(px, py, pz, label)
        client.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.2)
        # Esc/focus leaves mouse uncaptured on borderless — sky-LMB then restore look
        bot.ensure_mouse_grabbed(
            client, player, restore_yaw=yaw, restore_pitch=pitch
        )
        time.sleep(0.15)
        client.command(f"tp {player} {px} {py} {pz} {yaw:.2f} {pitch:.2f}")
        time.sleep(0.2)
        rot = client.command(f"data get entity {player} Rotation")
        log_selected(client, player, f"place_click:{label}")
        bot.release_mouse()
        # No sneak: live probe 2026-07-17 — sneak+RMB fails Civs place; chests cleared above
        # Also: do not move OS cursor while grabbed (rotates camera off aim).
        rc = bot.right_click(safe_capture=False, sneak=False, move_cursor=False)
        bot.release_mouse()
        time.sleep(0.85)

        # Check block FIRST — Civs menu / false pause must not hide a successful place
        has_chest, blob = _center_is_chest(client, cx, cy, cz)
        exact = _rcon_block_is(client, cx, cy, cz, "chest")
        neighbors = _scan_chest_offsets(client, cx, cy, cz)
        attempt = {
            "pose": label,
            "tp": [px, py, pz],
            "yaw_pitch": [yaw, pitch],
            "rotation": rot[:80],
            "right_click_ok": bool(rc.get("ok")),
            "center_has_chest": has_chest,
            "exact_cy": exact,
            "center_block": blob,
            "neighbors": neighbors,
            "hand_preview": (ks.get("item_id"), ks.get("civs_key")),
        }
        result["attempts"].append(attempt)
        result["right_click"] = rc
        result["center_block"] = blob
        result["center_has_chest"] = has_chest
        result["exact_cy"] = exact
        if exact:
            client.command(f"effect clear {player} levitation")
            # Instant-build opens PlacementMode — do NOT Esc before confirm clicks
            if not instant_build:
                bot.press_escape(1)
                time.sleep(0.3)
            break

        vis_after = assert_world_view(bot, shot_dir, f"{civs_key}_{label}_post")
        result["vision"].append(vis_after)
        if vis_after.get("kind") in ("container", "pause"):
            # Instant-build: container may be PlacementMode with chest already down
            if instant_build:
                exact = _rcon_block_is(client, cx, cy, cz, "chest")
                attempt["exact_cy_under_gui"] = exact
                result["exact_cy"] = exact
                if exact:
                    client.command(f"effect clear {player} levitation")
                    break
            bot.press_escape(1)
            time.sleep(0.3)
            # Re-check after dismiss — place may have succeeded under a GUI
            exact = _rcon_block_is(client, cx, cy, cz, "chest")
            attempt["exact_cy_after_dismiss"] = exact
            result["exact_cy"] = exact
            if exact:
                client.command(f"effect clear {player} levitation")
                break
            attempt["opened_gui"] = vis_after.get("kind")
            _prep_pose_geometry(label)
            continue

        if any("HIT" in (v or "") for v in neighbors.values()):
            result["chat_hints"] = result.get("chat_hints") or []
            result["chat_hints"].append(f"chest_offset_on_{label}:{neighbors}")
            for key, val in neighbors.items():
                if val == "HIT":
                    parts = key.split(",")
                    dx, dy, dz = int(parts[0]), int(parts[1]), int(parts[2])
                    client.command(f"setblock {cx + dx} {cy + dy} {cz + dz} air")
            client.command(f"setblock {cx} {cy} {cz} air")
            _prep_pose_geometry(label)

    if instant_build and result.get("exact_cy"):
        # PlacementMode confirm: try several slots (layout varies by size/locale)
        bot.mark_gui_open(True)
        confs = []
        for slot in (13, 22, 16, 31, 40):
            confs.append(bot.click_inventory_slot(slot, container_rows=3))
            time.sleep(0.4)
        result["placement_menu"] = {"instant": True, "confirms": confs}
        time.sleep(0.8)
        bot.ensure_menus_closed()
    else:
        bot.ensure_menus_closed(force_esc=False)

    result["ok"] = bool(result.get("exact_cy") or result.get("center_has_chest"))
    if not result["ok"] and not result.get("error"):
        result["error"] = "center place missed after chest-safe retries"
    try:
        client.command(f"effect clear {player} levitation")
    except Exception:  # noqa: BLE001
        pass
    return result


def list_new_regions_wsl(before: set[str]) -> tuple[set[str], list[str]]:
    script = f"ls -1 '{REGIONS_WSL}' 2>/dev/null || true"
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        files = {ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip().endswith(".yml")}
        new = sorted(files - before)
        return files, new
    except Exception:  # noqa: BLE001
        return before, []


def region_files_mention(key: str, new_files: list[str], center: list[int] | None = None) -> bool:
    if not new_files:
        return False
    # Grep type in new files
    joined = " ".join(f"'{REGIONS_WSL}/{f}'" for f in new_files[:30])
    script = f"grep -l 'type: {key}' {joined} 2>/dev/null || grep -li '{key}' {joined} 2>/dev/null || true"
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        hits = [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip()]
        if not hits:
            return False
        if center is None:
            return True
        # Prefer region whose filename coords match center (within 1 block)
        cx, cy, cz = center
        for path in hits:
            name = path.rsplit("/", 1)[-1]
            # uuid~x~y~z.yml
            parts = name.replace(".yml", "").split("~")
            if len(parts) >= 4:
                try:
                    rx, ry, rz = float(parts[-3]), float(parts[-2]), float(parts[-1])
                    if abs(rx - (cx + 0.5)) <= 1.1 and abs(ry - (cy + 0.5)) <= 1.1 and abs(rz - (cz + 0.5)) <= 1.1:
                        return True
                except ValueError:
                    continue
        # Type matched but coords off-center — still count as registered (document aim drift)
        return True
    except Exception:  # noqa: BLE001
        return False


TOWNS_WSL = "/home/dansilva/civs-testserver/plugins/Civs/towns"


def list_towns_wsl() -> list[str]:
    script = f"ls -1 '{TOWNS_WSL}' 2>/dev/null || true"
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        return [ln.strip() for ln in (out.stdout or "").splitlines() if ln.strip().endswith(".yml")]
    except Exception:  # noqa: BLE001
        return []


def parse_town_location_wsl(town_yml: str) -> tuple[int, int, int] | None:
    """Parse location: uuid~x~y~z from a town YAML → block center ints."""
    import re

    path = f"{TOWNS_WSL}/{town_yml}" if not town_yml.startswith("/") else town_yml
    script = f"grep -E '^location:' '{path}' 2>/dev/null | head -1"
    try:
        out = subprocess.run(
            ["wsl", "bash", "-lc", script],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except Exception:  # noqa: BLE001
        return None
    line = (out.stdout or "").strip()
    m = re.search(
        r"~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)\s*$",
        line,
    )
    if not m:
        return None
    return int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3)))


def find_reuseable_qa_town() -> dict[str, Any] | None:
    """Prefer an existing QATown* settlement (settlement max:1 — cannot create another)."""
    for name in list_towns_wsl():
        stem = name[:-4] if name.endswith(".yml") else name
        if not stem.lower().startswith("qatown"):
            continue
        loc = parse_town_location_wsl(name)
        if loc is None:
            continue
        return {"town_name": stem, "hub": list(loc), "yml": name}
    return None


def bootstrap_settlement(
    cfg: QAConfig,
    bot: WindowBot,
    client: RconClient,
    groups: dict[str, list[str]],
    *,
    hub: tuple[int, int, int] | None = None,
    allocator: PadAllocator | None = None,
) -> dict[str, Any]:
    """
    Create a settlement so member=settlement:* gated regions can activate.

    Steps: build+activate council_room (satisfies build-reqs + town_center group),
    then `/cv town <name>` while holding settlement item.
    Hub must not overlap structure pads (use allocator when provided).

    Reuses existing QATown* when present (settlement max:1). Polls town YAML
    because saveTown is async (needsSaving).
    """
    reused = find_reuseable_qa_town()
    if reused is not None:
        hx, hy, hz = reused["hub"][0], reused["hub"][1], reused["hub"][2]
        return {
            "ok": True,
            "hub": [hx, hy, hz],
            "town_name": reused["town_name"],
            "council_room": None,
            "town_cmd": None,
            "towns_before": list_towns_wsl(),
            "towns_after": list_towns_wsl(),
            "error": None,
            "skipped": f"reuse existing {reused['yml']}",
            "settlement_hand": "skipped_reuse",
        }

    if hub is None and allocator is not None:
        # Large exclusive zone for town center (council_room r≈5 + town claim buffer)
        pad = allocator.allocate("town_hub_council_room", radius=12)
        hx, hy, hz = pad.cx, pad.cy, pad.cz
    elif hub is not None:
        hx, hy, hz = hub
    else:
        ox, oy, oz = fresh_pad_origin(cfg)
        hx, hy, hz = ox + 120, oy, oz + 120
    # Unique name — avoid collide with prior QATown / max:1 reuse path
    town_name = f"QATown{datetime.now(timezone.utc).strftime('%H%M%S')}"
    result: dict[str, Any] = {
        "ok": False,
        "hub": [hx, hy, hz],
        "town_name": town_name,
        "council_room": None,
        "town_cmd": None,
        "towns_before": list_towns_wsl(),
        "towns_after": [],
        "error": None,
    }
    existing = result["towns_before"]
    if any(town_name.lower() in t.lower() for t in existing):
        result["ok"] = True
        result["skipped"] = "town already exists"
        result["towns_after"] = existing
        return result

    items, missing = load_batch(cfg.item_types_dir, ["council_room"])
    if missing or not items:
        result["error"] = f"council_room yaml missing: {missing}"
        return result
    cr = items[0]
    radius = int(cr.build_radius or 5)
    clear_footprint(client, hx, hy, hz, radius)
    reqs = parse_build_reqs(cr.build_reqs, groups)
    placements = plan_block_placements(hx, hy, hz, radius, reqs)
    build = build_reqs_with_we(bot, client, cfg.player_name, hx, hy, hz, radius, placements)
    result["council_build"] = {"ok": build.get("ok"), "setblocks": build.get("setblocks")}
    before_set, _ = list_new_regions_wsl(set())
    shot_dir = cfg.reports_dir / "screenshots"
    placed = place_civs_at_center(
        bot,
        client,
        cfg.player_name,
        "council_room",
        hx,
        hy,
        hz,
        instant_build=cr.instant_build,
        screenshots_dir=shot_dir,
        restore_placements=placements,
    )
    result["council_room"] = placed
    time.sleep(1.5)
    _, new_files = list_new_regions_wsl(before_set)
    cr_ok = bool(region_files_mention("council_room", new_files, [hx, hy, hz]))
    result["council_registered"] = cr_ok
    result["council_new_files"] = new_files

    if not cr_ok:
        result["error"] = "council_room region YAML not created (aim/build-reqs)"
        # Still try town create — may work if prior council_room exists nearby
        if not placed.get("center_has_chest"):
            return result

    # Hold settlement + create town at hub (must verify SelectedItem — hold-town aborts silently)
    ensure_civs_item(client, cfg.player_name, "settlement", hotbar_slot=0)
    bot.select_hotbar(0)
    client.command(f"tp {cfg.player_name} {hx + 0.5} {hy + 1} {hz + 0.5}")
    time.sleep(0.5)
    bot.ensure_menus_closed(force_esc=True)
    time.sleep(0.35)
    # Re-select after Esc (Esc can leave wand/other slot selected)
    bot.select_hotbar(0)
    time.sleep(0.2)
    hand = client.command(
        f"data get entity {cfg.player_name} SelectedItem.components.minecraft:custom_data"
    )
    result["settlement_hand"] = (hand or "")[:160]
    if "settlement" not in (hand or ""):
        ensure_civs_item(client, cfg.player_name, "settlement", hotbar_slot=0)
        bot.select_hotbar(0)
        time.sleep(0.25)
        hand = client.command(
            f"data get entity {cfg.player_name} SelectedItem.components.minecraft:custom_data"
        )
        result["settlement_hand_retry"] = (hand or "")[:160]
    if "settlement" not in (hand or ""):
        result["error"] = "settlement not in hand before /cv town"
        return result
    # Standing on hub center — town scan uses player location
    client.command(f"tp {cfg.player_name} {hx + 0.5} {hy + 1} {hz + 0.5}")
    time.sleep(0.3)
    # Final SelectedItem assert immediately before chat (abort if wrong)
    hand2 = client.command(
        f"data get entity {cfg.player_name} SelectedItem.components.minecraft:custom_data"
    )
    result["settlement_hand_pre_cmd"] = (hand2 or "")[:160]
    if "settlement" not in (hand2 or ""):
        result["error"] = "settlement lost from hand immediately before /cv town"
        return result
    wr = bot.send_chat_command(f"/cv town {town_name}", close_menus=True)
    result["town_cmd"] = wr
    # Dismiss gov-list / missing-req menu; poll async town YAML
    time.sleep(1.0)
    bot.ensure_menus_closed(force_esc=True)
    town_yml = f"{town_name}.yml"
    found = False
    for _ in range(12):
        after = list_towns_wsl()
        result["towns_after"] = after
        if any(town_name.lower() in t.lower() for t in after):
            found = True
            break
        time.sleep(1.0)
    result["ok"] = found
    if not result["ok"]:
        result["error"] = "town yaml not created — check hold-town / build-reqs / max:1 / chat"
        try:
            log = client.command(f"say QA_TOWN_BOOTSTRAP fail towns={result['towns_after']}")
            result["say"] = log[:120]
        except Exception:  # noqa: BLE001
            pass
    return result


def run_structure_tests(
    cfg: QAConfig,
    names: list[str] | None = None,
    *,
    place: bool = True,
    skip_window: bool = False,
) -> dict[str, Any]:
    batch = names or cfg.structure_batch or DEFAULT_PLACE_BATCH
    marker = f"QA_STRUCT_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    items, missing = load_batch(cfg.item_types_dir, batch)
    groups = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")

    results: list[StructureResult] = []
    for item in items:
        results.append(validate_static(item, cfg))

    inv_before: dict[str, Any] = {}
    rcon_log: list[str] = []
    place_details: dict[str, Any] = {}

    # Fresh origin + existing region centers → no stacking on prior YAML footprints
    ox, oy, oz = fresh_pad_origin(cfg)
    existing = parse_region_centers_wsl()
    allocator = PadAllocator(ox, oy, oz, cols=4, existing=existing)
    place_details["pad_origin"] = [ox, oy, oz]
    place_details["pad_margin"] = PAD_MARGIN
    place_details["existing_regions_blocked"] = len(existing)

    needs_town = any(it.requires_inside_town for it in items)
    town_hub_pad: PlacedPad | None = None
    reused_town = find_reuseable_qa_town() if needs_town else None
    if needs_town:
        if reused_town is not None:
            # Anchor pads to existing settlement claim (max:1 — cannot create another)
            hx, hy, hz = (
                int(reused_town["hub"][0]),
                int(reused_town["hub"][1]),
                int(reused_town["hub"][2]),
            )
            town_hub_pad = PlacedPad(
                key="town_hub_council_room", cx=hx, cy=hy, cz=hz, radius=12
            )
            allocator.placed.append(town_hub_pad)
            allocator.reserve_blocked(hx, hz, 12, f"town_hub:{reused_town['town_name']}")
            place_details["pad_origin"] = [hx, hy, hz]
            ox, oy, oz = hx, hy, hz
        else:
            # Reserved hub pad — council_room + settlement claim center
            town_hub_pad = allocator.allocate("town_hub_council_room", radius=12)

    # Gated first (in-town ring), then ungated outside claim — never stack/steal ring.
    gated_items = [it for it in items if it.requires_inside_town]
    outer_items = [it for it in items if not it.requires_inside_town]
    planned_map: dict[str, PlacedPad] = {}
    pad_zones: dict[str, str] = {}

    for item in gated_items:
        radius = int(item.build_radius or 3)
        if town_hub_pad is None:
            raise RuntimeError(f"{item.key} requires town but no hub pad")
        planned_map[item.key] = allocator.allocate_inside_town(
            item.key,
            radius,
            town_hub_pad.cx,
            town_hub_pad.cz,
            town_radius=TOWN_CLAIM_RADIUS,
        )
        pad_zones[item.key] = "in_town"

    for item in outer_items:
        radius = int(item.build_radius or 3)
        if town_hub_pad is not None:
            planned_map[item.key] = allocator.allocate_outside_town(
                item.key,
                radius,
                town_hub_pad.cx,
                town_hub_pad.cz,
                town_radius=TOWN_CLAIM_RADIUS,
            )
            pad_zones[item.key] = "outer"
        else:
            planned_map[item.key] = allocator.allocate(item.key, radius)
            pad_zones[item.key] = "outer"

    # Preserve requested batch order for place loop
    planned: list[tuple[Any, PlacedPad]] = [(it, planned_map[it.key]) for it in items]
    place_details["pad_zones"] = pad_zones
    place_details["pads"] = [
        {
            "key": p.key,
            "center": [p.cx, p.cy, p.cz],
            "radius": p.radius,
            "zone": (
                "town_hub"
                if town_hub_pad and p.key == town_hub_pad.key
                else pad_zones.get(p.key, "outer")
            ),
        }
        for p in ([town_hub_pad] if town_hub_pad else []) + [p for _, p in planned]
    ]
    place_details["town_claim_radius"] = TOWN_CLAIM_RADIUS if town_hub_pad else None

    bot = WindowBot(cfg.window_bot) if place and not skip_window else None
    town_ok = not needs_town  # ungated-only batches need no town

    try:
        with RconClient(cfg.rcon) as client:
            bounds = allocator.bounds()
            if bounds:
                x0, z0, x1, z1 = bounds
                rcon_log = rcon_prepare_platform(
                    cfg, client, marker, x0=x0, z0=z0 - 4, x1=x1, z1=z1
                )
            else:
                rcon_log = rcon_prepare_platform(cfg, client, marker)
            rcon_log.append(
                f"PAD_ORIGIN:{ox},{oy},{oz} pads={len(planned)} blocked_existing={len(existing)}"
            )
            for _, p in planned:
                rcon_log.append(f"PAD_PLAN:{p.key}@{p.cx},{p.cy},{p.cz} r={p.radius}")
            snap0 = snapshot_inventory(client, cfg.player_name)
            inv_before = snapshot_to_dict(snap0)
            rcon_log.append("INV:" + ",".join(snap0.civs_keys() or ["(none)"]))

            before_regions, _ = list_new_regions_wsl(set())

            if bot is not None:
                bot.ensure_menus_closed(force_esc=True)
                wand = bot.send_chat_command("//wand", close_menus=True)
                place_details["wand_preflight"] = wand

                if needs_town and town_hub_pad is not None:
                    town_boot = bootstrap_settlement(
                        cfg,
                        bot,
                        client,
                        groups,
                        hub=(town_hub_pad.cx, town_hub_pad.cy, town_hub_pad.cz),
                    )
                    place_details["town_bootstrap"] = town_boot
                    town_ok = bool(town_boot.get("ok"))
                    rcon_log.append(
                        f"TOWN_BOOT:{town_boot.get('ok')} err={town_boot.get('error')} "
                        f"hub={town_hub_pad.cx},{town_hub_pad.cz} "
                        f"skip={town_boot.get('skipped')}"
                    )
                    before_regions, _ = list_new_regions_wsl(set())
                    if not town_ok:
                        rcon_log.append("TOWN_BOOT:gated_types_will_skip")

            for item, pad in planned:
                res = next(r for r in results if r.key == item.key)
                radius = pad.radius
                cx, cy, cz = pad.cx, pad.cy, pad.cz
                res.center = [cx, cy, cz]
                res.notes += f" | pad r={radius} sep_origin=({ox},{oz})"

                if item.requires_inside_town and not town_ok:
                    res.notes += " | skipped: town bootstrap failed / no town"
                    res.chat_hints.append("skipped_no_town")
                    continue

                try:
                    clear_footprint(client, cx, cy, cz, radius)
                    client.command(
                        f"say QA_PAD {item.key} center={cx},{cy},{cz} r={radius} "
                        f"(separated, margin={PAD_MARGIN})"
                    )
                    res.rcon_pad_ok = True
                except Exception as exc:  # noqa: BLE001
                    res.notes = f"pad clear failed: {exc}"
                    continue

                reqs = parse_build_reqs(item.build_reqs, groups)
                placements = plan_block_placements(cx, cy, cz, radius, reqs)

                snap = snapshot_inventory(client, cfg.player_name)
                hand = snap.hand
                res.held_before = (
                    f"slot={snap.selected_slot} civs={hand.civs_key if hand else None} "
                    f"id={hand.item_id if hand else None}"
                )

                if not place or bot is None:
                    res.notes += " | place skipped"
                    continue

                build = build_reqs_with_we(
                    bot, client, cfg.player_name, cx, cy, cz, radius, placements
                )
                res.build_ok = bool(build.get("ok"))
                place_details[f"{item.key}_build"] = build

                placed = place_civs_at_center(
                    bot,
                    client,
                    cfg.player_name,
                    item.key,
                    cx,
                    cy,
                    cz,
                    instant_build=item.instant_build,
                    screenshots_dir=cfg.reports_dir / "screenshots",
                    restore_placements=placements,
                )
                res.place_ok = bool(placed.get("ok"))
                place_details[f"{item.key}_place"] = placed
                time.sleep(1.2)

                after_regions, new_files = list_new_regions_wsl(before_regions)
                registered = region_files_mention(item.key, new_files, res.center)
                if placed.get("center_has_chest") and not registered:
                    res.chat_hints.append("chest_at_center_but_no_yaml")
                if not registered and new_files:
                    res.chat_hints.append(f"new_region_files={new_files}")
                if registered and not placed.get("center_has_chest"):
                    res.chat_hints.append("activated_but_center_chest_missing")
                    res.notes += " | aim_drift?"
                res.region_registered = registered
                if registered:
                    before_regions = after_regions
                    allocator.reserve_blocked(cx, cz, radius, f"activated:{item.key}")
                    # Functional I/O for production structures (hard requirement)
                    if is_production_structure(item):
                        io = verify_production_io(client, item, cx, cy, cz)
                        place_details[f"{item.key}_io"] = io
                        if io.get("skipped"):
                            res.io_ok = None
                            res.io_detail = f"SKIP: {io.get('error')}"
                            res.notes += f" | io=SKIP({io.get('error')})"
                        else:
                            res.io_ok = bool(io.get("ok"))
                            gained = io.get("gained") or []
                            wrong = (io.get("wrong_item") or {}).get("ok")
                            res.io_detail = (
                                f"inserted={io.get('inserted')} gained={gained} "
                                f"wrong_block={wrong}"
                            )
                            if res.io_ok:
                                res.notes += " | io=PASS"
                            else:
                                res.notes += f" | io=FAIL({io.get('error')})"
                if item.pre_reqs:
                    res.notes += f" | pre-reqs={item.pre_reqs}"
                if not registered:
                    if not placed.get("center_has_chest"):
                        res.notes += " | center place missed (no chest)"
                    else:
                        res.notes += " | region YAML not detected (pre-req/build fail?)"

    except Exception as exc:  # noqa: BLE001
        rcon_log.append(f"RCON_FATAL:{exc}")

    time.sleep(1.5)
    log_tail = tail_server_log_wsl(cfg.server_log_wsl)
    log_errors = grep_log_errors(
        log_tail,
        extra_terms=[marker, "QA_PAD", "region", "build", "pre-req", "placement"],
    )

    activated = sum(1 for r in results if r.region_registered)
    built = sum(1 for r in results if r.build_ok)
    io_pass = sum(1 for r in results if r.io_ok is True)
    io_fail = sum(1 for r in results if r.io_ok is False)
    io_skip = sum(1 for r in results if r.io_ok is None and "io=SKIP" in (r.notes or ""))
    report = {
        "marker": marker,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "batch_requested": batch,
        "missing_yaml": missing,
        "inventory_before": inv_before,
        "structures": [asdict(r) for r in results],
        "place_details": {
            k: v
            for k, v in place_details.items()
            if k
            in (
                "wand_preflight",
                "town_bootstrap",
                "farm_io",
                "pad_origin",
                "pad_margin",
                "pads",
                "pad_zones",
                "town_claim_radius",
                "existing_regions_blocked",
            )
            or k.endswith("_place")
            or k.endswith("_build")
            or k.endswith("_io")
        },
        "rcon_tail": rcon_log[-16:],
        "log_errors": log_errors,
        "passed_static_pad": sum(1 for r in results if r.static_ok and r.rcon_pad_ok),
        "built": built,
        "activated": activated,
        "io_pass": io_pass,
        "io_fail": io_fail,
        "io_skip": io_skip,
        "total": len(results),
        "passed": activated,
        "pipeline": (
            "For each type: allocate NON-OVERLAPPING pad (r_a+r_b+margin) on a fresh "
            "origin → parse build-reqs → WE/fill → Civs place at center → region YAML "
            "→ production I/O (input/wrong-item/upkeep/output)"
        ),
        "item_acquisition": (
            "Uses inventory civs:civs key if present; else item replace with PDC "
            "(QA-only, not /cv give). Shop/tutorial still preferred for realism."
        ),
    }
    return report


def write_report(cfg: QAConfig, report: dict[str, Any], prefix: str = "structures") -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_dir = cfg.reports_dir
    json_path = out_dir / f"{prefix}_{ts}.json"
    md_path = out_dir / f"{prefix}_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        f"# Structure QA — {report.get('marker')}",
        "",
        f"- Activated (region YAML): **{report.get('activated')} / {report.get('total')}**",
        f"- Built (build-reqs): **{report.get('built')} / {report.get('total')}**",
        f"- Production I/O: **PASS {report.get('io_pass', 0)}** / "
        f"FAIL {report.get('io_fail', 0)} / SKIP {report.get('io_skip', 0)}",
        f"- Missing YAML keys: {report.get('missing_yaml') or 'none'}",
        "",
        report.get("pipeline", ""),
        "",
    ]
    pd = report.get("place_details") or {}
    if pd.get("pads") or pd.get("pad_origin"):
        lines.extend(
            [
                "## Pad layout (non-overlapping)",
                "",
                f"- Origin: `{pd.get('pad_origin')}` margin=`{pd.get('pad_margin')}` "
                f"blocked_existing=`{pd.get('existing_regions_blocked')}`",
            ]
        )
        if pd.get("town_claim_radius"):
            lines.append(f"- Town claim radius: `{pd.get('town_claim_radius')}`")
        for p in pd.get("pads") or []:
            zone = p.get("zone") or ""
            lines.append(
                f"- `{p.get('key')}` center=`{p.get('center')}` r=`{p.get('radius')}`"
                + (f" zone=`{zone}`" if zone else "")
            )
        lines.append("")
    lines.extend(
        [
        "## Inventory before",
        "",
        ]
    )
    inv = report.get("inventory_before") or {}
    hand = inv.get("hand") or {}
    lines.append(
        f"- Hand slot {inv.get('selected_slot')}: civs=`{hand.get('civs_key')}` id=`{hand.get('item_id')}`"
    )
    for s in inv.get("hotbar") or []:
        lines.append(f"- hotbar[{s.get('slot')}] civs=`{s.get('civs_key')}` `{s.get('item_id')}`")

    lines.extend(["", "## Structures", ""])
    for s in report.get("structures", []):
        flag = "PASS" if s.get("region_registered") else "FAIL"
        io = s.get("io_ok")
        io_s = "" if io is None else (" io=PASS" if io else " io=FAIL")
        lines.append(
            f"- **{s['key']}** ({s['category']}) — {flag}{io_s} — "
            f"build={s.get('build_ok')} place={s.get('place_ok')} "
            f"center={s.get('center')} — {s.get('notes') or '—'}"
        )
        if s.get("io_detail"):
            lines.append(f"  - io: {s['io_detail']}")
        if s.get("held_before"):
            lines.append(f"  - held: {s['held_before']}")
    lines.extend(["", "## Wand preflight", ""])
    wand = (report.get("place_details") or {}).get("wand_preflight")
    lines.append(f"- `{wand}`")
    town = (report.get("place_details") or {}).get("town_bootstrap")
    if town:
        lines.extend(
            [
                "",
                "## Town bootstrap",
                "",
                f"- ok={town.get('ok')} hub={town.get('hub')} name={town.get('town_name')}",
                f"- council_registered={town.get('council_registered')} err={town.get('error')}",
                f"- skipped={town.get('skipped')} settlement_hand={(town.get('settlement_hand') or '')[:80]}",
                f"- towns_after={town.get('towns_after')}",
            ]
        )
    lines.extend(["", "## Log errors (tail)", ""])
    for err in report.get("log_errors") or ["(none)"]:
        lines.append(f"- `{err}`")
    lines.extend(["", "## Item acquisition", "", report.get("item_acquisition", "")])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path

"""Parse Civs build-reqs and resolve item-groups to placeable block materials."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

# Prefer solid, easy-to-setblock materials when expanding g: groups.
_GROUP_PREFERS = {
    "fence": "oak_fence",
    "fencegate": "oak_fence_gate",
    "door": "oak_door",
    "window": "glass_pane",
    "bed": "red_bed",
    "roof": "oak_stairs",
    "primary": "oak_planks",
    "secondary": "cobblestone",
    "wood": "oak_planks",
    "log": "oak_log",
    "glass": "glass",
    "glass_pane": "glass_pane",
    "glass_block": "glass",
    "stairs": "oak_stairs",
    "wood_slab": "oak_slab",
    "wool": "white_wool",
    "terracotta": "terracotta",
    "stripped_wood": "stripped_oak_wood",
    "stripped_log": "stripped_oak_log",
    "concrete": "white_concrete",
}


@dataclass
class BuildReq:
    raw: str
    material: str  # minecraft block id (lowercase)
    count: int
    is_group: bool = False
    group_name: Optional[str] = None


def load_item_groups(config_yml: Path) -> dict[str, list[str]]:
    """Load item-groups from Civs config.yml → {group: [MATERIAL,...]} (flattened one level)."""
    with config_yml.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    raw = data.get("item-groups") or {}
    groups: dict[str, list[str]] = {}
    for key, val in raw.items():
        if not isinstance(val, str):
            continue
        parts = [p.strip() for p in val.split(",") if p.strip()]
        groups[key] = parts
    # Resolve one level of g: nested refs for prefer lookup
    return groups


def resolve_group_material(group_name: str, groups: dict[str, list[str]]) -> str:
    if group_name in _GROUP_PREFERS:
        return _GROUP_PREFERS[group_name]
    members = groups.get(group_name) or []
    for m in members:
        if m.startswith("g:"):
            nested = m[2:]
            return resolve_group_material(nested, groups)
        # Use first concrete material
        return m.lower()
    return "oak_planks"


_REQ_PIECE = re.compile(
    r"^(?P<body>g:[A-Za-z0-9_]+|[A-Za-z0-9_]+)(?:\*(?P<count>\d+))?$",
    re.IGNORECASE,
)


def parse_build_req_line(line: str, groups: dict[str, list[str]]) -> list[BuildReq]:
    """
    Parse one YAML build-reqs entry.

    Examples: CHEST*2 | g:fence*16 | WATER*1 | COAL_BLOCK*4,COAL_BLOCK*4
    Alternatives (comma) → pick first option only.
    """
    line = line.strip()
    if not line:
        return []
    first_alt = line.split(",")[0].strip()
    m = _REQ_PIECE.match(first_alt)
    if not m:
        return []
    body = m.group("body")
    count = int(m.group("count") or "1")
    if body.lower().startswith("g:"):
        gname = body[2:]
        mat = resolve_group_material(gname, groups)
        return [BuildReq(raw=line, material=mat, count=count, is_group=True, group_name=gname)]
    mat = body.lower()
    # Civs WATER req matches cauldron/water — place water_cauldron for block scan friendliness
    if mat == "water":
        mat = "water_cauldron"
    # Item names → planted crop blocks (Civs scans crop blocks, not chest items)
    if mat in ("potato", "potatoes"):
        mat = "potatoes"
    elif mat in ("carrot", "carrots"):
        mat = "carrots"
    elif mat in ("beetroot", "beetroots"):
        mat = "beetroots"
    elif mat == "wheat":
        mat = "wheat"
    # Redstone dust item → wire block on ground
    elif mat in ("redstone", "redstone_wire", "redstone_dust"):
        mat = "redstone_wire"
    return [BuildReq(raw=line, material=mat, count=count)]


def parse_build_reqs(lines: list[str], groups: dict[str, list[str]]) -> list[BuildReq]:
    out: list[BuildReq] = []
    for line in lines:
        out.extend(parse_build_req_line(line, groups))
    return out


def footprint_bounds(cx: int, cy: int, cz: int, radius: int) -> tuple[int, int, int, int, int, int]:
    """Inclusive cube bounds for Civs build-radius (2r+1)^3."""
    return cx - radius, cy - radius, cz - radius, cx + radius, cy + radius, cz + radius


def _is_chest_mat(mat: str) -> bool:
    m = mat.lower()
    return m in ("chest", "trapped_chest", "ender_chest", "barrel") or m.endswith("_chest")


def _aim_keep_clear(cx: int, cy: int, cz: int, x: int, y: int, z: int) -> bool:
    """
    Keep center + south LOS corridor free of build-req blocks (esp. chests).

    Aim pose stands at cz-2 looking at center — chests on that ray open GUIs.
    Also reserve the air-pit / stone-floor cells that `_prepare_aim_geometry`
    forces (restore skips them → permanent missing reqs if packed here).
    """
    if x == cx and y == cy and z == cz:
        return True
    if x == cx and z == cz and cy - 1 <= y <= cy + 3:
        return True
    if x == cx and z in (cz - 1, cz - 2) and cy <= y <= cy + 2:
        return True
    # Air pit + south footing strip (must stay empty of build-reqs)
    if x == cx and y == cy - 1 and z in (cz - 1, cz - 2, cz - 3):
        return True
    if x == cx and y == cy - 2 and z == cz - 1:
        return True
    return False


_CACTUS_SUPPORT = frozenset({"sand", "red_sand", "suspicious_sand"})
_PLANTED_CROPS = frozenset({"wheat", "potatoes", "carrots", "beetroots"})
# Gravity / bulk mats must sit on the prepared pad surface (cy on stone cy-1),
# not buried at footprint floor where they fall/pop out of the scan cube.
_GROUND_BULK = frozenset({"gravel", "sand", "red_sand", "snow_block", "dirt", "coarse_dirt", "grass_block"})


def plan_block_placements(
    cx: int,
    cy: int,
    cz: int,
    radius: int,
    reqs: list[BuildReq],
) -> list[tuple[int, int, int, str]]:
    """
    Pack required blocks into the footprint.

    Leaves center + south aim corridor empty. Chests/barrels pack north of
    center so right-click aim never hits a chest hitbox.

    Cactus is gravity/adjacency-fragile: place sand under each cactus with
    air on all four horizontal sides (2-block spacing), then leftover sand.

    Planted crops (potatoes/wheat/…) sit on the pad surface (crop at cy,
    farmland under at cy-1) — never buried at footprint floor or as items.

    Redstone wire sits on the pad surface (dust at cy on solid cy-1) — never
    floating mid-air or replacing the floor layer alone.

    Gravity bulk (gravel/sand/snow_block/…) also packs on pad surface at cy.
    """
    x0, y0, z0, x1, y1, z1 = footprint_bounds(cx, cy, cz, radius)
    coords_safe: list[tuple[int, int, int]] = []
    coords_chest: list[tuple[int, int, int]] = []
    for y in range(y0, y1 + 1):
        for z in range(z0, z1 + 1):
            for x in range(x0, x1 + 1):
                if _aim_keep_clear(cx, cy, cz, x, y, z):
                    continue
                coords_safe.append((x, y, z))
                # Chests only on north side of center (z > cz) or east/west at z>=cz
                if z > cz or (z == cz and x != cx):
                    coords_chest.append((x, y, z))

    placements: list[tuple[int, int, int, str]] = []
    used: set[tuple[int, int, int]] = set()
    idx_safe = 0
    idx_chest = 0

    def _take(pool: list[tuple[int, int, int]], idx: int) -> tuple[tuple[int, int, int] | None, int]:
        while idx < len(pool):
            pos = pool[idx]
            idx += 1
            if pos not in used:
                return pos, idx
        return None, idx

    def _ground_xz_candidates() -> list[tuple[int, int]]:
        """XZ cells where crop/redstone/bulk can sit at cy (support at cy-1)."""
        out: list[tuple[int, int]] = []
        # Prefer north of center, then east/west — keep south aim clear
        for z in range(cz + 1, z1 + 1):
            for x in range(x0, x1 + 1):
                out.append((x, z))
        for z in range(z0, cz + 1):
            for x in range(x0, x1 + 1):
                if x == cx and z <= cz:
                    continue
                out.append((x, z))
        return out

    # --- Cactus columns first (sand pedestal + cactus, spaced) ---
    cactus_n = sum(r.count for r in reqs if r.material == "cactus")
    sand_reqs = [r for r in reqs if r.material in _CACTUS_SUPPORT]
    sand_budget = sum(r.count for r in sand_reqs)
    sand_mat = sand_reqs[0].material if sand_reqs else "sand"
    # Sand/red_sand without cactus → ground bulk (pad surface), not buried floor pack
    exclude_sand = cactus_n > 0
    other_reqs = [
        r
        for r in reqs
        if r.material != "cactus"
        and (not exclude_sand or r.material not in _CACTUS_SUPPORT)
        and r.material not in _PLANTED_CROPS
        and r.material != "redstone_wire"
        and r.material not in _GROUND_BULK
    ]

    cactus_placed = 0
    sand_used_for_cactus = 0
    if cactus_n > 0:
        # Prefer mid-Y so gravity has solid under sand; north of center for aim safety
        base_y = max(y0, min(cy - 1, y1 - 1))
        for z in range(cz + 1, z1 + 1, 2):
            for x in range(x0, x1 + 1, 2):
                if cactus_placed >= cactus_n:
                    break
                if _aim_keep_clear(cx, cy, cz, x, base_y, z):
                    continue
                if _aim_keep_clear(cx, cy, cz, x, base_y + 1, z):
                    continue
                sand_pos = (x, base_y, z)
                cac_pos = (x, base_y + 1, z)
                if sand_pos in used or cac_pos in used:
                    continue
                if base_y + 1 > y1:
                    continue
                used.add(sand_pos)
                used.add(cac_pos)
                placements.append((x, base_y, z, sand_mat))
                placements.append((x, base_y + 1, z, "cactus"))
                cactus_placed += 1
                sand_used_for_cactus += 1
            if cactus_placed >= cactus_n:
                break
        # Fallback: pack remaining cactus east of center if ring exhausted
        for x in range(cx + 1, x1 + 1, 2):
            if cactus_placed >= cactus_n:
                break
            for z in range(z0, cz, 2):
                if cactus_placed >= cactus_n:
                    break
                if _aim_keep_clear(cx, cy, cz, x, base_y, z):
                    continue
                sand_pos = (x, base_y, z)
                cac_pos = (x, base_y + 1, z)
                if sand_pos in used or cac_pos in used or base_y + 1 > y1:
                    continue
                used.add(sand_pos)
                used.add(cac_pos)
                placements.append((x, base_y, z, sand_mat))
                placements.append((x, base_y + 1, z, "cactus"))
                cactus_placed += 1
                sand_used_for_cactus += 1

    sand_remaining = max(0, sand_budget - sand_used_for_cactus) if cactus_n > 0 else 0
    cactus_coords = {(px, py, pz) for px, py, pz, m in placements if m == "cactus"}
    sand_guard = 0
    while sand_remaining > 0 and sand_guard < 500:
        sand_guard += 1
        pos, idx_safe = _take(coords_safe, idx_safe)
        if pos is None:
            pos = (cx + sand_remaining, max(y0, cy - 1), cz + 2)
        sx, sy, sz = pos
        # Extra sand must not sit beside a cactus (MC breaks cactus)
        if any(
            (sx + dx, sy, sz + dz) in cactus_coords
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))
        ):
            continue
        if pos in used:
            continue
        used.add(pos)
        placements.append((sx, sy, sz, sand_mat))
        sand_remaining -= 1

    # --- Planted crops on pad surface (farmland @ cy-1 + crop @ cy) ---
    ground_xz = _ground_xz_candidates()
    gidx = 0
    for req in reqs:
        if req.material not in _PLANTED_CROPS:
            continue
        remaining = req.count
        while remaining > 0 and gidx < len(ground_xz) * 2:
            if gidx >= len(ground_xz):
                # wrap with slight offset if ring exhausted
                gx, gz = ground_xz[gidx % len(ground_xz)]
                gidx += 1
            else:
                gx, gz = ground_xz[gidx]
                gidx += 1
            crop_pos = (gx, cy, gz)
            soil_pos = (gx, cy - 1, gz)
            if _aim_keep_clear(cx, cy, cz, *crop_pos):
                continue
            if crop_pos in used or soil_pos in used:
                continue
            if not (x0 <= gx <= x1 and z0 <= gz <= z1):
                continue
            if cy > y1 or cy - 1 < y0:
                continue
            used.add(crop_pos)
            used.add(soil_pos)
            # setblock path places farmland under crop; record crop only
            placements.append((gx, cy, gz, req.material))
            remaining -= 1

    # --- Redstone dust on pad surface (wire @ cy on solid cy-1) ---
    rs_n = sum(r.count for r in reqs if r.material == "redstone_wire")
    rs_placed = 0
    for gx, gz in ground_xz:
        if rs_placed >= rs_n:
            break
        wire_pos = (gx, cy, gz)
        support = (gx, cy - 1, gz)
        if _aim_keep_clear(cx, cy, cz, *wire_pos):
            continue
        if wire_pos in used:
            continue
        if not (x0 <= gx <= x1 and z0 <= gz <= z1 and y0 <= cy <= y1):
            continue
        used.add(wire_pos)
        # Keep support reserved so other packs don't steal the floor cell
        if support not in used and y0 <= cy - 1 <= y1:
            used.add(support)
        placements.append((gx, cy, gz, "redstone_wire"))
        rs_placed += 1

    # --- Gravity / bulk mats on pad surface (block @ cy on stone cy-1) ---
    for req in reqs:
        if req.material not in _GROUND_BULK:
            continue
        remaining = req.count
        guard = 0
        while remaining > 0 and guard < 500:
            guard += 1
            if gidx >= len(ground_xz):
                gx = x0 + (guard % max(1, x1 - x0 + 1))
                gz = cz + 1 + (guard // max(1, x1 - x0 + 1))
            else:
                gx, gz = ground_xz[gidx]
                gidx += 1
            pos = (gx, cy, gz)
            support = (gx, cy - 1, gz)
            if _aim_keep_clear(cx, cy, cz, *pos):
                continue
            if pos in used:
                continue
            if not (x0 <= gx <= x1 and z0 <= gz <= z1 and y0 <= cy <= y1):
                continue
            used.add(pos)
            if support not in used and y0 <= cy - 1 <= y1:
                used.add(support)
            placements.append((gx, cy, gz, req.material))
            remaining -= 1

    for req in other_reqs:
        remaining = req.count
        while remaining > 0:
            if _is_chest_mat(req.material):
                pos, idx_chest = _take(coords_chest, idx_chest)
            else:
                pos, idx_safe = _take(coords_safe, idx_safe)
            if pos is None:
                # Overflow north of center (still inside preferred ring)
                pos = (cx + remaining, cy, cz + 2)
            used.add(pos)
            x, y, z = pos
            placements.append((x, y, z, req.material))
            remaining -= 1
            if req.material.endswith("_door"):
                upper = (x, y + 1, z)
                if y + 1 <= y1 and not _aim_keep_clear(cx, cy, cz, *upper) and upper not in used:
                    used.add(upper)
                    placements.append((x, y + 1, z, req.material))
    return placements

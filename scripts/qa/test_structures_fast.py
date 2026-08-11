"""Fast structure QA: RCON fill + /cv give + /cv placeregion. No WE wand / mouse place.

Target: ≥8 activate attempts in <10 minutes wall clock.
Use `run_all.py structures --legacy-window` for the old Esc/WE/aim path.
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_reqs import load_item_groups, parse_build_reqs, plan_block_placements
from item_types import ItemType, load_batch
from production_io import (
    is_production_structure,
    parse_upkeep_cycles,
    period_seconds,
)
from qa_config import QAConfig, grep_log_errors, tail_server_log_wsl
from rcon_client import RconClient
from test_structures import (
    PAD_MARGIN,
    REGIONS_WSL,
    TOWN_CLAIM_RADIUS,
    PadAllocator,
    find_reuseable_qa_town,
    list_new_regions_wsl,
    parse_region_centers_wsl,
    region_files_mention,
)

# Expanded coverage: more categories + short-period I/O where possible.
# Prefer short-period factories/quarries for I/O; long period → SKIP.
FAST_SMOKE_BATCH = [
    # Short I/O (period ≤20) — stock ASAP to beat RegionTick race
    "gravel_quarry",  # quarry/raw
    "dirt_quarry",  # quarry (OR outputs)
    "clay_quarry",  # quarry gated
    "ice_maker",  # factory ungated
    "dye_works",  # factory ungated (OR dyes)
    "flint_works",  # factory gated
    "concrete_factory",  # factory gated (OR concrete)
    # Activate + packing surface (gravity / cactus / crop / redstone)
    "cobble_quarry",  # quarry period 30 → I/O SKIP
    "coal_mine",  # mine long → SKIP
    "cactus_farm",  # farm gravity/cactus
    "potato_farm",  # farm gated crops
    "arrow_trap",  # defense redstone_wire
    "altar",  # offense redstone_block (not war-gated)
    "command_tent",  # offense
    # Housing / utility
    "shelter",  # housing starter
    "shack",  # housing gated
    "hovel",  # housing gated
    "purifier",  # utility long → SKIP
    "smithy",  # utility gated activate-only
    "redstone_mine",  # mine redstone_block packing
]

# Fast I/O: skip periods that need long waits; short poll after cv newday.
FAST_MAX_PERIOD_S = 20  # period > this → I/O SKIP (no wait)
FAST_IO_POLL_S = 12  # max seconds polling after newday
FAST_IO_POLL_INTERVAL = 0.25
FAST_PLACE_POLL_S = 2.0  # only if placeregion response ambiguous
FAST_PLACE_POLL_INTERVAL = 0.25
FAST_PAD_GAP_S = 0.05  # between structures (RCON-only)


@dataclass
class FastResult:
    key: str
    category: str
    center: list[int] | None = None
    build_ok: bool = False
    activated: bool = False
    io_ok: bool | None = None
    io_detail: str = ""
    error: str | None = None
    elapsed_s: float = 0.0
    elapsed_ms: int = 0
    place_ms: int = 0
    io_ms: int = 0
    notes: str = ""


def _rcon_ok(client: RconClient, cmd: str) -> str:
    try:
        return client.command(cmd) or ""
    except Exception as exc:  # noqa: BLE001
        return f"ERR:{exc}"


def _poll_until(predicate, *, timeout_s: float, interval_s: float) -> bool:
    deadline = time.perf_counter() + timeout_s
    while time.perf_counter() < deadline:
        if predicate():
            return True
        time.sleep(interval_s)
    return bool(predicate())


def _count_mat(blob: str, mat: str) -> int:
    needle = f"minecraft:{mat}"
    return blob.lower().count(needle)


def _items_count(client: RconClient, x: int, y: int, z: int, mat: str) -> int:
    """Count mat in container via execute-if-items (survives RCON NBT truncation)."""
    out = _rcon_ok(
        client, f"execute if items block {x} {y} {z} container.* minecraft:{mat}"
    )
    # "Test passed. Count: 4" or "Test failed"
    if "Test passed" not in out:
        return 0
    marker = "Count:"
    if marker in out:
        try:
            return int(out.split(marker, 1)[1].strip().split()[0])
        except (ValueError, IndexError):
            return 1
    return 1


def _output_mats(o: dict[str, Any]) -> list[str]:
    """All acceptable mats for one output line (OR-group aware)."""
    mats = o.get("mats")
    if isinstance(mats, list) and mats:
        return [str(m).lower() for m in mats if m]
    mat = str(o.get("mat", "")).split("%", 1)[0].split(",", 1)[0].strip()
    return [mat] if mat else []


def _chest_gained(
    client: RconClient,
    cx: int,
    cy: int,
    cz: int,
    radius: int,
    outputs: list[dict[str, Any]],
    before_counts: dict[str, int],
) -> list[dict[str, Any]]:
    """Gain check via execute-if-items (not truncated data-get blobs)."""
    gained: list[dict[str, Any]] = []
    for o in outputs:
        for mat in _output_mats(o):
            after = _items_count(client, cx, cy, cz, mat)
            delta = after - before_counts.get(mat, 0)
            if delta > 0:
                gained.append({"mat": mat, "delta": delta})
                break
    if gained:
        return gained
    # Neighbor chests (farms) — one shallow pass
    for o in outputs:
        for mat in _output_mats(o):
            if before_counts.get(mat, 0) > 0:
                continue
            for y in (cy, cy - 1, cy + 1):
                for z in (cz - 1, cz, cz + 1, cz + 2):
                    for x in (cx - 1, cx, cx + 1):
                        if x == cx and y == cy and z == cz:
                            continue
                        if abs(x - cx) > radius or abs(z - cz) > radius:
                            continue
                        if _items_count(client, x, y, z, mat) > 0:
                            gained.append({"mat": mat, "delta": 1, "at": [x, y, z]})
                            return gained
    return gained


def _setblock_mat(client: RconClient, x: int, y: int, z: int, mat: str) -> None:
    """Place one build-req block. Crops = planted on farmland; redstone = dust on solid."""
    base = mat.split("[", 1)[0]
    if base.endswith("_door"):
        _rcon_ok(client, f"setblock {x} {y} {z} {mat}[half=lower]")
        _rcon_ok(client, f"setblock {x} {y + 1} {z} {mat}[half=upper]")
    elif base.endswith("_bed"):
        _rcon_ok(client, f"setblock {x} {y} {z} {mat}[part=foot]")
    elif mat == "water_cauldron":
        _rcon_ok(client, f"setblock {x} {y} {z} water_cauldron[level=3]")
    elif mat == "cactus":
        _rcon_ok(client, f"setblock {x} {y - 1} {z} sand")
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            _rcon_ok(client, f"setblock {x + dx} {y} {z + dz} air")
        _rcon_ok(client, f"setblock {x} {y} {z} cactus")
    elif mat in ("wheat", "potatoes", "carrots", "beetroots"):
        # Planted crop in soil — never a potato item / floating plant
        _rcon_ok(client, f"setblock {x} {y - 1} {z} farmland")
        age = "7" if mat != "beetroots" else "3"
        _rcon_ok(client, f"setblock {x} {y} {z} {mat}[age={age}]")
    elif mat == "redstone_wire":
        # Dust on solid ground — never floating / chest-only
        _rcon_ok(client, f"setblock {x} {y - 1} {z} stone")
        _rcon_ok(client, f"setblock {x} {y} {z} minecraft:redstone_wire")
    elif mat in ("gravel", "sand", "red_sand", "snow_block"):
        # Gravity/bulk on solid pad surface — support under then mat
        _rcon_ok(client, f"setblock {x} {y - 1} {z} stone")
        _rcon_ok(client, f"setblock {x} {y} {z} {mat}")
    else:
        _rcon_ok(client, f"setblock {x} {y} {z} {mat}")


def rcon_fill_build_reqs(
    client: RconClient,
    cx: int,
    cy: int,
    cz: int,
    radius: int,
    placements: list[tuple[int, int, int, str]],
) -> dict[str, Any]:
    """Burst fill pad + setblock build-reqs. No WorldEdit / mouse."""
    x0, z0 = cx - radius - 1, cz - radius - 1
    x1, z1 = cx + radius + 1, cz + radius + 1
    _rcon_ok(client, f"fill {x0} {cy - 1} {z0} {x1} {cy - 1} {z1} stone")
    _rcon_ok(client, f"fill {x0} {cy} {z0} {x1} {cy + max(2, radius)} {z1} air")
    placed = 0
    solid = [
        p
        for p in placements
        if p[3]
        not in (
            "redstone_wire",
            "wheat",
            "potatoes",
            "carrots",
            "beetroots",
            "gravel",
            "sand",
            "red_sand",
            "snow_block",
            "cactus",
        )
    ]
    fragile = [p for p in placements if p not in solid]
    for x, y, z, mat in solid + fragile:
        if (x, y, z) == (cx, cy, cz):
            continue
        try:
            _setblock_mat(client, x, y, z, mat)
            placed += 1
        except Exception:  # noqa: BLE001
            pass
    for x, y, z, mat in fragile:
        base = mat.split("[", 1)[0]
        if base in (
            "gravel",
            "sand",
            "red_sand",
            "snow_block",
            "cactus",
            "redstone_wire",
            "potatoes",
            "wheat",
            "carrots",
            "beetroots",
        ):
            _setblock_mat(client, x, y, z, mat)
    _rcon_ok(client, f"setblock {cx} {cy} {cz} air")
    _rcon_ok(client, f"setblock {cx} {cy - 1} {cz} stone")
    return {"ok": placed > 0 or not placements, "setblocks": placed}


def verify_production_io_fast(
    client: RconClient, item: ItemType, cx: int, cy: int, cz: int
) -> dict[str, Any]:
    """Stock via RCON → cv newday → poll ≤FAST_IO_POLL_S. No long period waits."""
    period = period_seconds(item)
    cycles = parse_upkeep_cycles(item)
    result: dict[str, Any] = {
        "ok": False,
        "skipped": False,
        "key": item.key,
        "period_s": period,
    }
    if not cycles or not any(c.get("outputs") for c in cycles):
        result["skipped"] = True
        result["error"] = "no item outputs in upkeep"
        return result
    if period > FAST_MAX_PERIOD_S:
        result["skipped"] = True
        result["error"] = f"period {period}s > FAST_MAX_PERIOD_S={FAST_MAX_PERIOD_S}"
        return result

    cycle = next((c for c in cycles if c["outputs"]), cycles[0])
    result["yaml_upkeep"] = {
        "tools": cycle["tools"],
        "reagents": cycle["reagents"],
        "inputs": cycle["inputs"],
        "outputs": cycle["outputs"],
        "period_s": period,
    }
    # Single data-merge stock (beats RegionTick race: lastTick=0 → first
    # empty-chest tick burns period past our ≤12s poll).
    nbt_slots: list[str] = []
    inserted: list[str] = []
    slot = 0
    for mat in cycle["tools"]:
        nbt_slots.append(
            f'{{Slot:{slot}b,id:"minecraft:{mat}",count:1}}'
        )
        inserted.append(f"tool:{mat}")
        slot += 1
    for mat in cycle["reagents"]:
        qty = 64 if mat in ("gravel", "sand", "cobblestone", "dirt", "snow_block") else 16
        if mat.endswith("_shovel") or mat.endswith("_pickaxe") or mat.endswith("_axe"):
            qty = 1
        if mat in ("cauldron", "bucket", "water_bucket", "lava_bucket"):
            qty = 1
        nbt_slots.append(
            f'{{Slot:{slot}b,id:"minecraft:{mat}",count:{qty}}}'
        )
        inserted.append(f"reagent:{mat}x{qty}")
        slot += 1
    for mat in cycle["inputs"]:
        nbt_slots.append(
            f'{{Slot:{slot}b,id:"minecraft:{mat}",count:16}}'
        )
        inserted.append(f"input:{mat}x16")
        slot += 1
    items_nbt = ",".join(nbt_slots)
    _rcon_ok(client, f"data merge block {cx} {cy} {cz} {{Items:[{items_nbt}]}}")
    result["inserted"] = inserted
    # Snapshot expected mats via execute-if-items (data-get truncates multi-slot NBT)
    before_counts: dict[str, int] = {}
    for o in cycle["outputs"]:
        for mat in _output_mats(o):
            before_counts[mat] = _items_count(client, cx, cy, cz, mat)
    result["before_counts"] = before_counts
    # newday only forces daily-period regions; still call for docs / daily types
    client.command("cv newday")
    _rcon_ok(client, f"tp @p {cx + 0.5} {cy + 1} {cz + 0.5}")

    radius = int(item.build_radius or 3)
    gained: list[dict[str, Any]] = []
    polls = 0
    t_io = time.perf_counter()

    def _check() -> bool:
        nonlocal gained, polls
        polls += 1
        gained = _chest_gained(client, cx, cy, cz, radius, cycle["outputs"], before_counts)
        return bool(gained)

    _poll_until(_check, timeout_s=FAST_IO_POLL_S, interval_s=FAST_IO_POLL_INTERVAL)
    result["wait_s"] = round(time.perf_counter() - t_io, 2)
    result["polls"] = polls
    result["gained"] = gained
    result["ok"] = bool(gained)
    if not gained:
        result["error"] = (
            f"no output after poll={result['wait_s']}s; inserted={inserted}; "
            f"expected={cycle['outputs']}"
        )
    return result


def run_fast_structure_tests(
    cfg: QAConfig,
    *,
    names: list[str] | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    marker = f"QA_FAST_{datetime.now(timezone.utc).strftime('%H%M%S')}"
    batch = names or FAST_SMOKE_BATCH
    items, missing = load_batch(cfg.item_types_dir, batch)
    groups = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")
    if not groups:
        groups = load_item_groups(cfg.item_types_dir.parent / "config.yml")

    results: list[FastResult] = []
    place_details: dict[str, Any] = {}
    town_info: dict[str, Any] = {}

    # Fresh origin east of prior clutter
    ox = 4000 + int(time.time()) % 500
    oy = 81
    oz = 4000
    existing = parse_region_centers_wsl()
    allocator = PadAllocator(ox, oy, oz, cols=4, existing=existing)

    with RconClient(cfg.rcon) as client:
        player = cfg.player_name
        _rcon_ok(client, f"say {marker} fast structure QA")
        _rcon_ok(client, f"op {player}")
        _rcon_ok(client, f"gamemode creative {player}")
        _rcon_ok(client, "time set day")

        reused = find_reuseable_qa_town()
        hub_cx = hub_cz = None
        # Satellite allocator stays at fresh origin for ungated / outside pads
        satellite = allocator
        if reused:
            hx, hy, hz = reused["hub"]
            hub_cx, hub_cz = hx, hz
            town_info = {
                "ok": True,
                "hub": [hx, hy, hz],
                "town_name": reused["town_name"],
                "skipped": f"reuse {reused['yml']}",
            }
            allocator = PadAllocator(hx, hy, hz, cols=4, existing=existing)
            allocator.reserve_blocked(hx, hz, 12, "town_hub")
        else:
            town_info = {"ok": False, "error": "no QATown* — gated types may FAIL"}

        # Pre-allocate all pads (gated types SKIP if town ring full — never place outside)
        pads: dict[str, tuple[int, int, int, int]] = {}
        skip_alloc: dict[str, str] = {}
        for item in items:
            r = int(item.build_radius or 3)
            need_town = item.requires_inside_town or item.requires_town_membership
            try:
                if need_town and town_info.get("ok") and hub_cx is not None:
                    pad = allocator.allocate_inside_town(
                        item.key, radius=r, hub_cx=hub_cx, hub_cz=hub_cz
                    )
                elif need_town:
                    skip_alloc[item.key] = "no QATown* for gated type"
                    continue
                elif town_info.get("ok") and hub_cx is not None:
                    # Clean satellite far from hub (always outside settlement claim)
                    pad = satellite.allocate(item.key, radius=r)
                else:
                    pad = satellite.allocate(item.key, radius=r)
            except RuntimeError as exc:
                if need_town:
                    skip_alloc[item.key] = f"town ring full: {exc}"
                    continue
                skip_alloc[item.key] = f"pad exhausted: {exc}"
                continue
            pads[item.key] = (pad.cx, pad.cy, pad.cz, r)

        # Prep+place one-at-a-time (burst-all-prep wiped neighbor pads)
        before_regions, _ = list_new_regions_wsl(set())
        _rcon_ok(client, f"clear {player}")

        for item in items:
            t_item = time.perf_counter()
            if item.key in skip_alloc:
                fr = FastResult(key=item.key, category=item.category)
                fr.error = skip_alloc[item.key]
                fr.notes = "SKIP(alloc)"
                fr.elapsed_ms = 0
                results.append(fr)
                print(f"[FAST] {item.key} SKIP alloc: {fr.error}", flush=True)
                continue

            cx, cy, cz, radius = pads[item.key]
            fr = FastResult(key=item.key, category=item.category, center=[cx, cy, cz])

            reqs = parse_build_reqs(item.build_reqs, groups)
            placements = plan_block_placements(cx, cy, cz, radius, reqs)
            build = rcon_fill_build_reqs(client, cx, cy, cz, radius, placements)
            place_details[f"{item.key}_build"] = build
            place_details[f"{item.key}_placements"] = len(placements)
            fr.build_ok = bool(build.get("ok"))

            t_place = time.perf_counter()
            # Avoid group-max FAIL from leftover region tokens in inventory
            _rcon_ok(client, f"clear {player}")
            _rcon_ok(client, f"tp {player} {cx + 0.5} {cy + 2} {cz + 0.5}")

            give_out = _rcon_ok(client, f"cv give {player} {item.key} 1")
            place_out = _rcon_ok(
                client, f"cv placeregion {player} {item.key} {cx} {cy} {cz}"
            )
            place_details[f"{item.key}_give"] = give_out[:200]
            place_details[f"{item.key}_place"] = place_out[:200]

            activated = "placeregion OK" in (place_out or "")
            place_failed = "placeregion FAIL" in (place_out or "")
            if not activated and not place_failed:
                # Only poll YAML when command was ambiguous — not on hard FAIL
                def _yaml_ready() -> bool:
                    after, new_files = list_new_regions_wsl(before_regions)
                    return region_files_mention(item.key, new_files, [cx, cy, cz])

                activated = _poll_until(
                    _yaml_ready,
                    timeout_s=FAST_PLACE_POLL_S,
                    interval_s=FAST_PLACE_POLL_INTERVAL,
                )
            fr.place_ms = int((time.perf_counter() - t_place) * 1000)
            fr.activated = activated

            # I/O FIRST after place — WSL YAML scans can take >200ms and lose the
            # lastTick=0 race against CommonScheduler (every 4 ticks / 1/10 regions).
            if activated and is_production_structure(item):
                period = period_seconds(item)
                if period > FAST_MAX_PERIOD_S:
                    fr.io_ok = None
                    fr.io_detail = f"SKIP period={period}s"
                    fr.notes = "io=SKIP(long period)"
                    fr.io_ms = 0
                else:
                    t_io = time.perf_counter()
                    io = verify_production_io_fast(client, item, cx, cy, cz)
                    fr.io_ms = int((time.perf_counter() - t_io) * 1000)
                    place_details[f"{item.key}_io"] = io
                    if io.get("skipped"):
                        fr.io_ok = None
                        fr.io_detail = f"SKIP: {io.get('error')}"
                        fr.notes = f"io=SKIP({io.get('error')})"
                    else:
                        fr.io_ok = bool(io.get("ok"))
                        fr.io_detail = (
                            f"inserted={io.get('inserted')} gained={io.get('gained')} "
                            f"poll={io.get('wait_s')}s"
                        )
                        fr.notes = "io=PASS" if fr.io_ok else f"io=FAIL({io.get('error')})"

            if activated:
                after, new_files = list_new_regions_wsl(before_regions)
                before_regions = after
                allocator.reserve_blocked(cx, cz, radius, f"activated:{item.key}")
                satellite.reserve_blocked(cx, cz, radius, f"activated:{item.key}")
            elif not activated:
                fr.error = place_out[:180] if place_out else "not activated"
                if "Unknown" in (give_out or "") or "permission" in (give_out or "").lower():
                    fr.error = f"give failed: {give_out[:120]}"

            fr.elapsed_s = round(time.perf_counter() - t_item, 2)
            fr.elapsed_ms = int(fr.elapsed_s * 1000)
            results.append(fr)
            print(
                f"[FAST] {item.key} act={fr.activated} io={fr.io_ok} "
                f"{fr.elapsed_ms}ms (place={fr.place_ms} io={fr.io_ms})",
                flush=True,
            )
            time.sleep(FAST_PAD_GAP_S)

    wall = round(time.perf_counter() - t0, 1)
    activated_n = sum(1 for r in results if r.activated)
    io_pass = sum(1 for r in results if r.io_ok is True)
    io_fail = sum(1 for r in results if r.io_ok is False)
    io_skip = sum(1 for r in results if r.io_ok is None and r.activated)

    report = {
        "marker": marker,
        "mode": "fast",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "wall_clock_s": wall,
        "batch": batch,
        "missing_yaml": missing,
        "town": town_info,
        "results": [asdict(r) for r in results],
        "activated": activated_n,
        "attempted": len(results),
        "built": sum(1 for r in results if r.build_ok),
        "io_pass": io_pass,
        "io_fail": io_fail,
        "io_skip": io_skip,
        "place_details": place_details,
        "throughput": {
            "attempts_per_min": round(len(results) / max(wall / 60, 0.01), 2),
            "target_met": len(results) >= 8 and wall < 600,
        },
        "log_errors": grep_log_errors(
            tail_server_log_wsl(cfg.server_log_wsl),
            extra_terms=[marker, "placeregion", "give", "region"],
        ),
    }
    return report


def write_fast_report(cfg: QAConfig, report: dict[str, Any]) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    json_path = cfg.reports_dir / f"structures_fast_{ts}.json"
    md_path = cfg.reports_dir / f"structures_fast_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        f"# Fast structure QA — {report['marker']}",
        "",
        f"- Wall clock: **{report['wall_clock_s']}s**",
        f"- Activated: **{report['activated']} / {report['attempted']}**",
        f"- I/O: PASS={report['io_pass']} FAIL={report['io_fail']} SKIP={report['io_skip']}",
        f"- Throughput target (≥8 in <10m): **{report['throughput']['target_met']}**",
        "",
        "## Results",
        "",
    ]
    for r in report.get("results", []):
        notes = r.get("notes") or ""
        if notes.startswith("SKIP"):
            flag = "SKIP"
        else:
            flag = "PASS" if r.get("activated") else "FAIL"
        io = r.get("io_ok")
        io_s = "io=PASS" if io is True else ("io=FAIL" if io is False else (notes or "io=—"))
        lines.append(
            f"- **{r['key']}** ({r.get('category')}) — {flag} {io_s} "
            f"center={r.get('center')} "
            f"**{r.get('elapsed_ms', int((r.get('elapsed_s') or 0) * 1000))}ms** "
            f"(place={r.get('place_ms')} io={r.get('io_ms')})"
        )
        if r.get("error"):
            lines.append(f"  - error: `{r['error']}`")
        if r.get("io_detail"):
            lines.append(f"  - {r['io_detail']}")
    lines.extend(["", "## Town", "", f"```json\n{json.dumps(report.get('town'), indent=2)}\n```", ""])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return json_path

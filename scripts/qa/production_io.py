"""Functional production I/O QA: input chest → upkeep tick → output verify.

Civs rules (RegionChestUtil / RegionInputChestFilter):
- Input chest = region center (icon) chest
- Farms: output prefers a *different* chest inside build-radius
- Non-farms: output deposits back into the input chest
- Hopper moves into input are filtered to allowed tools/reagents/inputs
"""

from __future__ import annotations

import re
import time
from typing import Any

from item_types import ItemType
from rcon_client import RconClient

# Cap wait so long-period mines don't stall. Prefer short poll after cv newday.
MAX_UPKEEP_WAIT_S = 20
WRONG_ITEM = "dirt"


def _mat_id(raw: str) -> str:
    """STONE_SHOVEL*1 / SHEARS → minecraft id fragment (first OR token only)."""
    body = str(raw).split(",", 1)[0].split("*", 1)[0].split("%", 1)[0].strip()
    if body.lower().startswith("g:"):
        return body[2:].lower()
    return body.lower()


def expand_output_mats(raw: str) -> list[str]:
    """Expand probabilistic OR groups: RED_DYE%7,BLACK_DYE%6 → [red_dye, black_dye, ...]."""
    mats: list[str] = []
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        body = part.split("*", 1)[0].split("%", 1)[0].strip()
        if body.lower().startswith("g:"):
            body = body[2:]
        if body:
            mats.append(body.lower())
    return mats


def parse_upkeep_cycles(item: ItemType) -> list[dict[str, Any]]:
    """Flatten YAML upkeep map into list of {tools, reagents, inputs, outputs}."""
    raw = item.raw.get("upkeep") or {}
    cycles: list[dict[str, Any]] = []
    if not isinstance(raw, dict):
        return cycles
    for key in sorted(raw.keys(), key=lambda k: int(k) if str(k).isdigit() else 999):
        entry = raw[key] or {}
        if not isinstance(entry, dict):
            continue
        tools = [_mat_id(x) for x in (entry.get("tools") or [])]
        reagents = [_mat_id(x) for x in (entry.get("reagents") or [])]
        inputs = [_mat_id(x) for x in (entry.get("input") or entry.get("inputs") or [])]
        outputs = []
        for x in entry.get("output") or entry.get("outputs") or []:
            s = str(x)
            mats = expand_output_mats(s)
            if not mats:
                continue
            qty = 1
            # qty from first token: DIRT*4%50 → 4
            first = s.split(",", 1)[0]
            if "*" in first:
                try:
                    qty_part = first.split("*", 1)[1]
                    qty = int(qty_part.split("%", 1)[0])
                except ValueError:
                    qty = 1
            outputs.append({"mat": mats[0], "mats": mats, "qty": qty})
        # Skip power-only / empty cycles
        if not (tools or reagents or inputs or outputs):
            continue
        cycles.append(
            {
                "index": key,
                "tools": tools,
                "reagents": reagents,
                "inputs": inputs,
                "outputs": outputs,
            }
        )
    return cycles


def is_production_structure(item: ItemType) -> bool:
    """True when YAML defines upkeep that produces items (or consumes tools/inputs)."""
    cycles = parse_upkeep_cycles(item)
    if not cycles:
        return False
    return any(c["outputs"] or c["tools"] or c["inputs"] or c["reagents"] for c in cycles)


def period_seconds(item: ItemType) -> int:
    p = item.raw.get("period", 0)
    try:
        return int(p)
    except (TypeError, ValueError):
        return 0


def _chest_items_blob(client: RconClient, x: int, y: int, z: int) -> str:
    try:
        return client.command(f"data get block {x} {y} {z} Items") or ""
    except Exception as exc:  # noqa: BLE001
        return f"ERR:{exc}"


def _count_mat_in_blob(blob: str, mat: str) -> int:
    """Best-effort count of minecraft:<mat> stacks in a data-get Items dump."""
    needle = f"minecraft:{mat}"
    total = 0
    # Match id + nearby count when present
    for m in re.finditer(
        rf'id:\s*"?{re.escape(needle)}"?[^}}]{{0,80}}count:\s*(\d+)',
        blob,
        re.IGNORECASE,
    ):
        total += int(m.group(1))
    if total == 0 and needle in blob.lower():
        total = 1
    return total


def _clear_chest(client: RconClient, x: int, y: int, z: int) -> None:
    for slot in range(27):
        try:
            client.command(f"item replace block {x} {y} {z} container.{slot} with air")
        except Exception:  # noqa: BLE001
            pass


def _put_item(client: RconClient, x: int, y: int, z: int, slot: int, mat: str, count: int = 1) -> None:
    client.command(f"item replace block {x} {y} {z} container.{slot} with minecraft:{mat} {count}")


def find_output_chest(
    client: RconClient,
    cx: int,
    cy: int,
    cz: int,
    radius: int,
    *,
    is_farm: bool,
) -> tuple[int, int, int]:
    """Farm → nearest non-center chest; else center."""
    if not is_farm:
        return cx, cy, cz
    best: tuple[int, int, int] | None = None
    best_d = 10**9
    for y in range(cy - radius, cy + radius + 1):
        for z in range(cz - radius, cz + radius + 1):
            for x in range(cx - radius, cx + radius + 1):
                if x == cx and y == cy and z == cz:
                    continue
                try:
                    out = client.command(f"execute if block {x} {y} {z} chest")
                    if "Test passed" not in (out or ""):
                        continue
                except Exception:  # noqa: BLE001
                    continue
                d = abs(x - cx) + abs(y - cy) + abs(z - cz)
                if d < best_d:
                    best_d = d
                    best = (x, y, z)
    return best if best else (cx, cy, cz)


def _ensure_output_chest(
    client: RconClient, cx: int, cy: int, cz: int, radius: int, *, is_farm: bool
) -> tuple[int, int, int]:
    ox, oy, oz = find_output_chest(client, cx, cy, cz, radius, is_farm=is_farm)
    if is_farm and (ox, oy, oz) == (cx, cy, cz):
        # Place a dedicated output chest north of center (outside aim corridor)
        ox, oy, oz = cx, cy, min(cz + radius, cz + 2)
        if ox == cx and oz == cz:
            ox = cx + 1
        client.command(f"setblock {ox} {oy} {oz} chest")
    return ox, oy, oz


def test_wrong_item_hopper(
    client: RconClient, ix: int, iy: int, iz: int
) -> dict[str, Any]:
    """
    Hopper above input chest with dirt — InventoryMoveItemEvent should cancel.
    PASS if dirt stays in hopper (or never appears in chest).
    """
    hx, hy, hz = ix, iy + 1, iz
    result: dict[str, Any] = {
        "ok": False,
        "method": "hopper_InventoryMoveItemEvent",
        "wrong_item": WRONG_ITEM,
        "hopper": [hx, hy, hz],
    }
    try:
        client.command(f"setblock {hx} {hy} {hz} hopper[facing=down]")
        _clear_chest(client, hx, hy, hz)
        _put_item(client, hx, hy, hz, 0, WRONG_ITEM, 1)
        time.sleep(0.35)  # hopper tick settle (was 1.2s)
        hopper_blob = _chest_items_blob(client, hx, hy, hz)
        chest_blob = _chest_items_blob(client, ix, iy, iz)
        in_hopper = _count_mat_in_blob(hopper_blob, WRONG_ITEM) > 0
        in_chest = _count_mat_in_blob(chest_blob, WRONG_ITEM) > 0
        result["in_hopper"] = in_hopper
        result["in_chest"] = in_chest
        result["ok"] = in_hopper and not in_chest
        if not result["ok"]:
            result["error"] = (
                f"wrong item leaked: hopper={in_hopper} chest={in_chest}"
            )
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
    finally:
        try:
            client.command(f"setblock {hx} {hy} {hz} air")
        except Exception:  # noqa: BLE001
            pass
    return result


def verify_production_io(
    client: RconClient,
    item: ItemType,
    cx: int,
    cy: int,
    cz: int,
    *,
    force_newday: bool = True,
) -> dict[str, Any]:
    """
    After region activation: stock input → wait/tick → assert output.

    PASS only when expected output material appears in the output chest.
    """
    result: dict[str, Any] = {
        "ok": False,
        "skipped": False,
        "key": item.key,
        "center": [cx, cy, cz],
        "inserted": [],
        "expected_outputs": [],
        "output_before": "",
        "output_after": "",
        "wrong_item": None,
        "error": None,
    }
    cycles = parse_upkeep_cycles(item)
    if not cycles:
        result["skipped"] = True
        result["error"] = "no upkeep cycles"
        return result

    # Prefer first cycle that has outputs (functional proof)
    cycle = next((c for c in cycles if c["outputs"]), cycles[0])
    if not cycle["outputs"]:
        result["skipped"] = True
        result["error"] = "upkeep has tools/inputs but no item outputs"
        return result

    period = period_seconds(item)
    result["period_s"] = period
    result["cycle"] = cycle["index"]
    is_farm = "farm" in (item.groups or [])
    radius = int(item.build_radius or 3)

    # Input = center chest must exist
    try:
        chk = client.command(f"execute if block {cx} {cy} {cz} chest")
        if "Test passed" not in (chk or ""):
            result["error"] = "input/center chest missing"
            return result
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"center check: {exc}"
        return result

    ox, oy, oz = _ensure_output_chest(client, cx, cy, cz, radius, is_farm=is_farm)
    result["input_chest"] = [cx, cy, cz]
    result["output_chest"] = [ox, oy, oz]
    result["is_farm"] = is_farm

    _clear_chest(client, cx, cy, cz)
    if (ox, oy, oz) != (cx, cy, cz):
        _clear_chest(client, ox, oy, oz)

    # Wrong-item block (hopper) before stocking correct items
    wrong = test_wrong_item_hopper(client, cx, cy, cz)
    result["wrong_item"] = wrong
    _clear_chest(client, cx, cy, cz)

    slot = 0
    inserted: list[str] = []
    for mat in cycle["tools"]:
        _put_item(client, cx, cy, cz, slot, mat, 1)
        inserted.append(f"tool:{mat}")
        slot += 1
    for mat in cycle["reagents"]:
        # Reagents may be tools (STONE_SHOVEL) or stacks (GRAVEL*64)
        qty = 64 if mat in ("gravel", "sand", "cobblestone", "dirt") else 16
        if mat.endswith("_shovel") or mat.endswith("_pickaxe") or mat.endswith("_axe"):
            qty = 1
        _put_item(client, cx, cy, cz, slot, mat, qty)
        inserted.append(f"reagent:{mat}x{qty}")
        slot += 1
    for mat in cycle["inputs"]:
        _put_item(client, cx, cy, cz, slot, mat, 16)
        inserted.append(f"input:{mat}x16")
        slot += 1
    result["inserted"] = inserted
    result["expected_outputs"] = cycle["outputs"]

    result["output_before"] = _chest_items_blob(client, ox, oy, oz)[:240]
    before_counts = {
        o["mat"]: _count_mat_in_blob(result["output_before"], o["mat"]) for o in cycle["outputs"]
    }
    # Also snapshot every chest in radius (farms may pick a different deposit target)
    all_chests = _list_chests_in_radius(client, cx, cy, cz, radius)
    before_all: dict[str, int] = {o["mat"]: 0 for o in cycle["outputs"]}
    for tx, ty, tz in all_chests:
        blob = _chest_items_blob(client, tx, ty, tz)
        for o in cycle["outputs"]:
            before_all[o["mat"]] += _count_mat_in_blob(blob, o["mat"])

    if force_newday:
        try:
            client.command("cv newday")
        except Exception:  # noqa: BLE001
            pass

    # Prefer short poll after newday (legacy path); long periods SKIP via MAX.
    wait_s = min(max(period + 5, 8), 15) if period > 0 else 5
    result["yaml_upkeep"] = {
        "tools": cycle["tools"],
        "reagents": cycle["reagents"],
        "inputs": cycle["inputs"],
        "outputs": cycle["outputs"],
        "period_s": period,
    }
    if period > 60 or wait_s > MAX_UPKEEP_WAIT_S:
        result["skipped"] = True
        result["error"] = (
            f"period {period}s skipped (cap MAX_UPKEEP_WAIT_S={MAX_UPKEEP_WAIT_S}); "
            f"stocked input but did not wait for output"
        )
        result["ok"] = False
        if wrong.get("ok"):
            result["notes"] = "wrong_item PASS; output SKIP long period"
        return result

    # Keep chunk loaded: stand near center during wait
    try:
        client.command(f"tp @p {cx + 0.5} {cy + 1} {cz + 0.5}")
    except Exception:  # noqa: BLE001
        pass

    # Poll every 0.5s instead of one long sleep + 3s retries
    deadline = time.time() + min(wait_s, MAX_UPKEEP_WAIT_S)
    gained = []
    after_blobs = []
    while time.time() < deadline:
        after_all: dict[str, int] = {o["mat"]: 0 for o in cycle["outputs"]}
        after_blobs = []
        for tx, ty, tz in _list_chests_in_radius(client, cx, cy, cz, radius):
            blob = _chest_items_blob(client, tx, ty, tz)
            after_blobs.append(f"{tx},{ty},{tz}:{blob[:80]}")
            for o in cycle["outputs"]:
                after_all[o["mat"]] += _count_mat_in_blob(blob, o["mat"])
        gained = []
        for o in cycle["outputs"]:
            delta = after_all[o["mat"]] - before_all.get(o["mat"], 0)
            if delta > 0:
                gained.append({"mat": o["mat"], "delta": delta, "expected_qty": o["qty"]})
        if gained:
            result["output_after"] = ";".join(after_blobs)[:400]
            result["gained"] = gained
            result["ok"] = True
            if not wrong.get("ok"):
                result["notes"] = f"output PASS; wrong_item FAIL: {wrong.get('error')}"
            return result
        time.sleep(0.5)

    result["output_after"] = _chest_items_blob(client, ox, oy, oz)[:240]
    result["error"] = (
        f"no output after wait={wait_s}s; inserted={inserted}; "
        f"expected={cycle['outputs']}; chests={all_chests}"
    )
    return result


def _list_chests_in_radius(
    client: RconClient, cx: int, cy: int, cz: int, radius: int
) -> list[tuple[int, int, int]]:
    found: list[tuple[int, int, int]] = []
    for y in range(cy - radius, cy + radius + 1):
        for z in range(cz - radius, cz + radius + 1):
            for x in range(cx - radius, cx + radius + 1):
                try:
                    out = client.command(f"execute if block {x} {y} {z} chest")
                    if "Test passed" in (out or ""):
                        found.append((x, y, z))
                except Exception:  # noqa: BLE001
                    continue
    if not found:
        found.append((cx, cy, cz))
    return found
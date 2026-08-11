"""Player inventory snapshot via RCON (hand / hotbar / full inventory).

Daniel hard requirements (2026-07-17):
- Before EVERY WE/place action: dump SelectedItem + Inventory
- Classify hotbar: WE wand | Civs region item | junk
- Press 1–9 for the action; re-verify SelectedItem; abort if wrong
- Never left-click world with chest/Civs selected (breaks build-reqs)
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from rcon_client import RconClient

logger = logging.getLogger(__name__)

# Dedicated slots — never overwrite wand when staging Civs items
WAND_SLOT = 8
CIVS_SLOT = 0

WAND_IDS = (
    "minecraft:wooden_axe",
    "minecraft:stone_axe",
    "minecraft:iron_axe",
    "minecraft:golden_axe",
    "minecraft:diamond_axe",
    "minecraft:netherite_axe",
)


@dataclass
class InvSlot:
    slot: int
    item_id: str
    count: int = 1
    civs_key: Optional[str] = None
    custom_name: Optional[str] = None
    kind: str = "junk"  # wand | civs | junk | empty


@dataclass
class InventorySnapshot:
    player: str
    selected_slot: int = 0
    hand: Optional[InvSlot] = None
    hotbar: list[InvSlot] = field(default_factory=list)
    inventory: list[InvSlot] = field(default_factory=list)
    raw_selected: str = ""
    raw_selected_slot: str = ""
    error: Optional[str] = None

    def find_civs(self, key: str) -> Optional[InvSlot]:
        key_l = key.lower().replace("-", "_")
        for slot in self.inventory:
            if slot.civs_key and slot.civs_key.lower().replace("-", "_") == key_l:
                return slot
        return None

    def find_wand(self) -> Optional[InvSlot]:
        for slot in self.hotbar:
            if slot.kind == "wand":
                return slot
        for slot in self.inventory:
            if slot.kind == "wand":
                return slot
        return None

    def civs_keys(self) -> list[str]:
        return [s.civs_key for s in self.inventory if s.civs_key]


_SLOT_RE = re.compile(
    r"Slot:\s*(-?\d+)b,\s*id:\s*\"([^\"]+)\",\s*count:\s*(\d+)",
    re.IGNORECASE,
)
_CIVS_RE = re.compile(r'"civs:civs"\s*:\s*"([^"]+)"')
_NAME_RE = re.compile(r'"minecraft:custom_name"\s*:\s*"([^"]+)"')
_ID_RE = re.compile(r'id:\s*"([^"]+)"')


def _classify_slot(item_id: str, civs_key: Optional[str]) -> str:
    if not item_id or item_id in ("air", "minecraft:air", "unknown"):
        return "empty"
    if civs_key:
        return "civs"
    if item_id in WAND_IDS or item_id.endswith("_axe"):
        return "wand"
    return "junk"


def _parse_inventory_blob(blob: str) -> list[InvSlot]:
    slots: list[InvSlot] = []
    parts = re.split(r"(?=Slot:\s*-?\d+b)", blob)
    for part in parts:
        m = _SLOT_RE.search(part)
        if not m:
            continue
        slot_i = int(m.group(1))
        item_id = m.group(2)
        civs = None
        cm = _CIVS_RE.search(part)
        if cm:
            civs = cm.group(1)
        name = None
        nm = _NAME_RE.search(part)
        if nm:
            name = nm.group(1)
        slots.append(
            InvSlot(
                slot=slot_i,
                item_id=item_id,
                count=int(m.group(3)),
                civs_key=civs,
                custom_name=name,
                kind=_classify_slot(item_id, civs),
            )
        )
    return slots


def snapshot_inventory(client: RconClient, player: str) -> InventorySnapshot:
    """Dump hand/hotbar/inventory. Enriches hotbar slots with per-slot custom_data."""
    snap = InventorySnapshot(player=player)
    try:
        sel_slot_raw = client.command(f"data get entity {player} SelectedItemSlot")
        snap.raw_selected_slot = sel_slot_raw[:160]
        m = re.search(r"(\d+)\s*$", sel_slot_raw.strip())
        if not m:
            m = re.search(r"data:\s*(\d+)", sel_slot_raw)
        if m:
            snap.selected_slot = int(m.group(1))
        snap.raw_selected = client.command(f"data get entity {player} SelectedItem")
        inv_blob = client.command(f"data get entity {player} Inventory")
        parsed = _parse_inventory_blob(inv_blob)
        by_slot = {s.slot: s for s in parsed}

        for i in range(9):
            # Always resolve hotbar 0–8 by id (wand/axe has no custom_data)
            try:
                id_out = client.command(
                    f"data get entity {player} Inventory[{{Slot:{i}b}}].id"
                )
            except Exception:  # noqa: BLE001
                continue
            if "Found no elements" in id_out or not id_out:
                continue
            id_m = re.search(r'"([^"]+)"', id_out)
            item_id = id_m.group(1) if id_m else "unknown"
            if i not in by_slot:
                by_slot[i] = InvSlot(slot=i, item_id=item_id)
            else:
                by_slot[i].item_id = item_id

            civs = None
            try:
                cd = client.command(
                    f"data get entity {player} Inventory[{{Slot:{i}b}}].components.minecraft:custom_data"
                )
                if cd and "Found no elements" not in cd:
                    cm = _CIVS_RE.search(cd)
                    if cm:
                        civs = cm.group(1)
                        by_slot[i].civs_key = civs
            except Exception:  # noqa: BLE001
                pass
            by_slot[i].kind = _classify_slot(by_slot[i].item_id, by_slot[i].civs_key)
            try:
                nm = client.command(
                    f"data get entity {player} Inventory[{{Slot:{i}b}}].components.minecraft:custom_name"
                )
                if "Found no" not in nm:
                    nm_m = re.search(r'"([^"]+)"\s*$', nm.strip())
                    if nm_m:
                        by_slot[i].custom_name = nm_m.group(1)
            except Exception:  # noqa: BLE001
                pass

        snap.inventory = sorted(by_slot.values(), key=lambda s: s.slot)
        snap.hotbar = [s for s in snap.inventory if 0 <= s.slot <= 8]
        hand = by_slot.get(snap.selected_slot)
        if hand is None and snap.raw_selected and "has the following" in snap.raw_selected:
            cm = _CIVS_RE.search(snap.raw_selected)
            id_m = _ID_RE.search(snap.raw_selected)
            civs = cm.group(1) if cm else None
            iid = id_m.group(1) if id_m else "unknown"
            hand = InvSlot(
                slot=snap.selected_slot,
                item_id=iid,
                civs_key=civs,
                kind=_classify_slot(iid, civs),
            )
        snap.hand = hand
    except Exception as exc:  # noqa: BLE001
        snap.error = str(exc)
    return snap


def log_selected(client: RconClient, player: str, label: str) -> dict[str, Any]:
    """Daniel: print SelectedItemSlot + item id before every place/WE step."""
    snap = snapshot_inventory(client, player)
    hand = snap.hand
    info = {
        "label": label,
        "SelectedItemSlot": snap.selected_slot,
        "item_id": hand.item_id if hand else None,
        "civs_key": hand.civs_key if hand else None,
        "kind": hand.kind if hand else "empty",
        "hotbar": [
            {
                "slot": s.slot,
                "id": s.item_id,
                "kind": s.kind,
                "civs": s.civs_key,
            }
            for s in snap.hotbar
        ],
    }
    msg = (
        f"[HOTBAR:{label}] slot={info['SelectedItemSlot']} "
        f"id={info['item_id']} kind={info['kind']} civs={info['civs_key']}"
    )
    logger.info(msg)
    print(msg, flush=True)
    return info


def find_civs_hotbar_slot(snap: InventorySnapshot, civs_key: str) -> Optional[int]:
    """Return hotbar slot 0–8 holding civs_key, or None."""
    key_l = civs_key.lower().replace("-", "_")
    for s in snap.hotbar:
        if s.civs_key and s.civs_key.lower().replace("-", "_") == key_l:
            return s.slot
    for s in snap.inventory:
        if 0 <= s.slot <= 8 and s.civs_key:
            if s.civs_key.lower().replace("-", "_") == key_l:
                return s.slot
    return None


def ensure_civs_item(
    client: RconClient,
    player: str,
    civs_key: str,
    *,
    hotbar_slot: int = CIVS_SLOT,
) -> dict[str, Any]:
    """
    Ensure player has a Civs region token in the given hotbar slot.

    Prefer an existing inventory item with matching civs:civs key; otherwise
    place via `item replace` with PublicBukkitValues PDC (QA-only, not /cv give).
    Never writes to WAND_SLOT.
    """
    if hotbar_slot == WAND_SLOT:
        hotbar_slot = CIVS_SLOT
    result: dict[str, Any] = {
        "ok": False,
        "civs_key": civs_key,
        "source": None,
        "slot": hotbar_slot,
        "error": None,
    }
    snap = snapshot_inventory(client, player)
    existing = snap.find_civs(civs_key)
    if existing is not None and existing.slot == hotbar_slot:
        result["ok"] = True
        result["source"] = "inventory"
        return result

    replace = (
        f"item replace entity {player} hotbar.{hotbar_slot} with "
        f"chest[minecraft:custom_data="
        f'{{PublicBukkitValues:{{"civs:civs":"{civs_key}"}}}},'
        f'minecraft:custom_name="{civs_key}"] 1'
    )
    out = client.command(replace)
    snap2 = snapshot_inventory(client, player)
    found = snap2.find_civs(civs_key)
    if found is None:
        give_cmd = (
            f"give {player} chest[minecraft:custom_data="
            f'{{PublicBukkitValues:{{"civs:civs":"{civs_key}"}}}},'
            f'minecraft:custom_name="{civs_key}"] 1'
        )
        out2 = client.command(give_cmd)
        snap3 = snapshot_inventory(client, player)
        found = snap3.find_civs(civs_key)
        if found is not None and found.slot != hotbar_slot:
            client.command(replace)
            found = snapshot_inventory(client, player).find_civs(civs_key)
        out = f"{out}; {out2}"
    if found is None:
        result["error"] = f"failed to put civs:{civs_key} in inventory: {out}"
        return result
    if found.slot != hotbar_slot:
        client.command(replace)
        found = snapshot_inventory(client, player).find_civs(civs_key)
    result["ok"] = found is not None and (
        found.slot == hotbar_slot or 0 <= (found.slot or -1) <= 8
    )
    result["source"] = "inventory" if existing else "pdc_replace"
    result["slot"] = found.slot if found else hotbar_slot
    result["detail"] = out[:300]
    return result


def ensure_wand(
    client: RconClient,
    player: str,
    bot: Any,
    *,
    slot: int = WAND_SLOT,
) -> dict[str, Any]:
    """Give //wand if missing, park axe in WAND_SLOT, select it, verify."""
    result: dict[str, Any] = {
        "ok": False,
        "slot": slot,
        "source": None,
        "selected": None,
        "error": None,
    }
    log_selected(client, player, "ensure_wand_before")
    snap = snapshot_inventory(client, player)
    wand = snap.find_wand()
    if wand is None:
        # Chat //wand puts wooden axe in inventory
        wr = bot.send_chat_command("//wand", close_menus=True)
        result["wand_chat"] = wr
        time.sleep(0.5)
        snap = snapshot_inventory(client, player)
        wand = snap.find_wand()
        result["source"] = "chat_//wand"
    else:
        result["source"] = "already_held"

    if wand is None:
        # Fallback: wooden axe (WE treats as wand for most installs)
        client.command(
            f"item replace entity {player} hotbar.{slot} with minecraft:wooden_axe 1"
        )
        snap = snapshot_inventory(client, player)
        wand = snap.find_wand()
        result["source"] = "wooden_axe_replace"

    if wand is None:
        result["error"] = "no WE wand after //wand + wooden_axe"
        return result

    if wand.slot != slot:
        # Move wand into dedicated slot without wiping civs in CIVS_SLOT
        client.command(
            f"item replace entity {player} hotbar.{slot} with {wand.item_id} 1"
        )
        if wand.slot != slot and 0 <= wand.slot <= 8 and wand.slot != CIVS_SLOT:
            client.command(f"item replace entity {player} hotbar.{wand.slot} with air")
        wand_slot = slot
    else:
        wand_slot = wand.slot

    result["slot"] = wand_slot
    sel = select_hotbar_expect(
        bot, client, player, slot=wand_slot, expect_kind="wand", label="select_wand"
    )
    result["selected"] = sel
    result["ok"] = bool(sel.get("ok"))
    if not result["ok"]:
        result["error"] = sel.get("error") or "wand select failed"
    log_selected(client, player, "ensure_wand_after")
    return result


def select_hotbar_expect(
    bot: Any,
    client: RconClient,
    player: str,
    *,
    slot: int,
    expect_kind: str | None = None,
    expect_civs: str | None = None,
    expect_id_substr: str | None = None,
    label: str = "select",
) -> dict[str, Any]:
    """
    Press key 1–9, then RCON-verify SelectedItem. Abort (ok=False) if wrong.

    expect_kind: wand | civs | junk
    expect_civs: required civs:civs key when kind is civs
    """
    result: dict[str, Any] = {
        "ok": False,
        "slot": slot,
        "key": str(slot + 1),
        "label": label,
        "before": None,
        "after": None,
        "error": None,
    }
    if not (0 <= slot <= 8):
        result["error"] = f"invalid hotbar slot {slot}"
        return result

    result["before"] = log_selected(client, player, f"{label}_before")
    bot.release_mouse()
    # Pause/menu eats hotbar keys — soft recover before 1–9
    try:
        bot.abort_if_pause_trap()
    except Exception:  # noqa: BLE001
        bot.press_escape(1)
        time.sleep(0.2)
        bot.press_escape(1)
    bot.focus_minecraft(click_to_focus=False)
    time.sleep(0.15)

    after = None
    for attempt in range(3):
        bot.select_hotbar(slot)
        time.sleep(0.25)
        after = log_selected(client, player, f"{label}_after")
        kind = after.get("kind")
        civs = after.get("civs_key")
        item_id = after.get("item_id") or ""
        ok_try = True
        if expect_kind == "wand":
            ok_try = kind == "wand" or any(item_id.endswith(x) for x in ("_axe",))
        elif expect_kind == "civs" or expect_civs:
            want = (expect_civs or "").lower().replace("-", "_")
            got = (civs or "").lower().replace("-", "_")
            ok_try = bool(want) and want == got
        elif expect_id_substr:
            ok_try = expect_id_substr in item_id
        if ok_try:
            break
        bot.press_escape(1)
        time.sleep(0.2)
        bot.focus_minecraft(click_to_focus=False)
        time.sleep(0.15)

    result["after"] = after or log_selected(client, player, f"{label}_after")

    slot_out = client.command(f"data get entity {player} SelectedItemSlot")
    m = re.search(r"data:\s*(\d+)", slot_out) or re.search(r"(\d+)\s*$", slot_out.strip())
    selected_slot = int(m.group(1)) if m else result["after"].get("SelectedItemSlot")
    result["selected_slot"] = selected_slot
    result["selected_slot_raw"] = slot_out[:120]
    result["hand_raw"] = client.command(f"data get entity {player} SelectedItem")[:300]

    kind = result["after"].get("kind")
    civs = result["after"].get("civs_key")
    item_id = result["after"].get("item_id") or ""

    ok = True
    if selected_slot is not None and selected_slot != slot:
        result["notes"] = f"SelectedItemSlot={selected_slot} expected {slot}"
    if expect_kind == "wand":
        ok = kind == "wand" or any(item_id.endswith(x) for x in ("_axe",))
    elif expect_kind == "civs" or expect_civs:
        want = (expect_civs or "").lower().replace("-", "_")
        got = (civs or "").lower().replace("-", "_")
        ok = bool(want) and want == got
    elif expect_id_substr:
        ok = expect_id_substr in item_id

    result["ok"] = bool(ok)
    result["hand_ok"] = ok
    result["kind"] = kind
    result["civs_key"] = civs
    result["item_id"] = item_id
    if not ok:
        result["error"] = (
            f"ABORT [{label}]: after key {result['key']} got kind={kind} "
            f"id={item_id} civs={civs} (expected kind={expect_kind} civs={expect_civs})"
        )
        print(result["error"], flush=True)
        logger.error(result["error"])
    return result


def select_hotbar_key_and_verify(
    bot: Any,
    client: RconClient,
    player: str,
    civs_key: str,
    slot: int,
) -> dict[str, Any]:
    """HARD: press 1–9 for Civs item, verify SelectedItem has civs_key."""
    return select_hotbar_expect(
        bot,
        client,
        player,
        slot=slot,
        expect_kind="civs",
        expect_civs=civs_key,
        label=f"civs:{civs_key}",
    )


def prepare_hotbar_for_placement(
    client: RconClient,
    player: str,
    civs_key: str,
    *,
    preferred_slot: int = CIVS_SLOT,
    bot: Any = None,
) -> dict[str, Any]:
    """
    Inventory hygiene + HARD hotbar key select before Civs placement.

    1. RCON dump — classify hotbar
    2. Preserve WAND_SLOT; stage civs_key in CIVS_SLOT
    3. Clear other junk/conflicting civs (never wand slot)
    4. Press key 1–9; verify SelectedItem; abort if wrong
    """
    if preferred_slot == WAND_SLOT:
        preferred_slot = CIVS_SLOT
    result: dict[str, Any] = {
        "ok": False,
        "civs_key": civs_key,
        "slot": preferred_slot,
        "cleared": [],
        "dump_preview": None,
        "key_select": None,
        "hand_ok": False,
        "error": None,
    }
    result["before"] = log_selected(client, player, f"place_prep:{civs_key}")

    try:
        raw = client.command(f"data get entity {player} Inventory")
        result["dump_preview"] = raw[:400]
    except Exception as exc:  # noqa: BLE001
        result["dump_preview"] = f"ERR:{exc}"

    snap = snapshot_inventory(client, player)
    result["keys_before"] = snap.civs_keys()
    result["selected_before"] = snap.selected_slot

    # Preserve wand: if wand is in preferred_slot, move it to WAND_SLOT first
    wand = snap.find_wand()
    if wand is not None and wand.slot == preferred_slot:
        client.command(
            f"item replace entity {player} hotbar.{WAND_SLOT} with {wand.item_id} 1"
        )
        client.command(f"item replace entity {player} hotbar.{preferred_slot} with air")

    put = ensure_civs_item(client, player, civs_key, hotbar_slot=preferred_slot)
    result["ensure"] = put
    if not put.get("ok"):
        result["error"] = put.get("error") or "ensure failed"
        return result

    # Clear OTHER hotbar slots except WAND_SLOT and preferred
    for slot in range(9):
        if slot in (preferred_slot, WAND_SLOT):
            continue
        try:
            cd = client.command(
                f"data get entity {player} Inventory[{{Slot:{slot}b}}].components.minecraft:custom_data"
            )
            id_out = client.command(
                f"data get entity {player} Inventory[{{Slot:{slot}b}}].id"
            )
            # Keep wand if it somehow sits here
            if any(a in id_out for a in ("_axe",)):
                continue
            # Clear conflicting civs or chests
            if "civs:civs" in cd and civs_key not in cd:
                client.command(f"item replace entity {player} hotbar.{slot} with air")
                result["cleared"].append(slot)
            elif "chest" in id_out and civs_key not in cd:
                client.command(f"item replace entity {player} hotbar.{slot} with air")
                result["cleared"].append(slot)
        except Exception:  # noqa: BLE001
            pass

    result["slot"] = preferred_slot

    if bot is None:
        result["error"] = "bot required for hotbar key 1-9 select (Daniel hard requirement)"
        result["ok"] = False
        return result

    key_sel = select_hotbar_key_and_verify(bot, client, player, civs_key, preferred_slot)
    result["key_select"] = key_sel
    result["hand_ok"] = bool(key_sel.get("hand_ok"))
    result["hand_check"] = key_sel.get("hand_raw") or key_sel.get("after")
    result["ok"] = bool(key_sel.get("ok"))
    if not result["ok"]:
        result["error"] = key_sel.get("error") or "hotbar key select failed"
    result["after"] = log_selected(client, player, f"place_ready:{civs_key}")
    return result


def snapshot_to_dict(snap: InventorySnapshot) -> dict[str, Any]:
    return asdict(snap)


def format_snapshot_md(snap: InventorySnapshot) -> str:
    lines = [
        f"## Inventory — {snap.player}",
        "",
        f"- Selected slot: **{snap.selected_slot}**",
    ]
    if snap.hand:
        lines.append(
            f"- Hand: `{snap.hand.item_id}` kind=`{snap.hand.kind}` "
            f"civs=`{snap.hand.civs_key}` name=`{snap.hand.custom_name}`"
        )
    lines.extend(["", "### Hotbar", ""])
    if not snap.hotbar:
        lines.append("- (empty)")
    for s in snap.hotbar:
        lines.append(
            f"- [{s.slot}] `{s.item_id}` x{s.count} kind=`{s.kind}` "
            f"civs=`{s.civs_key}` name=`{s.custom_name}`"
        )
    lines.extend(["", "### All slots", ""])
    for s in snap.inventory:
        lines.append(
            f"- [{s.slot}] `{s.item_id}` x{s.count} kind=`{s.kind}` civs=`{s.civs_key}`"
        )
    if snap.error:
        lines.extend(["", f"Error: `{snap.error}`"])
    return "\n".join(lines)

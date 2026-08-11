"""Prune QA region YAMLs near QATown hub + outside smoke corridor, then cv reload."""
from __future__ import annotations

import re
import subprocess

from qa_config import load_config
from rcon_client import RconClient

REG = "/home/dansilva/civs-testserver/plugins/Civs/regions"
HUB = (3000, 2600)
KEEP_TYPES = {"council_room", "town_hall", "capitol", "fort", "castle"}
# Town claim + outside smoke corridor that allocate_outside_town uses
CHEBY_R = 120
NAME_RE = re.compile(
    r"~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)\.yml$",
    re.I,
)


def wsl(cmd: str) -> str:
    out = subprocess.run(
        ["wsl", "bash", "-lc", cmd],
        capture_output=True,
        text=True,
        timeout=90,
        check=False,
    )
    return (out.stdout or "") + (out.stderr or "")


def main() -> None:
    listing = wsl(f"ls -1 '{REG}'")
    files = [ln.strip() for ln in listing.splitlines() if ln.strip().endswith(".yml")]
    to_delete: list[str] = []
    for name in files:
        m = NAME_RE.search(name)
        if not m:
            continue
        x, _y, z = float(m.group(1)), float(m.group(2)), float(m.group(3))
        dist = max(abs(x - HUB[0]), abs(z - HUB[1]))
        if dist > CHEBY_R:
            continue
        typ = wsl(f"grep -m1 '^type:' '{REG}/{name}' | sed 's/^type: *//'").strip().splitlines()
        typ_s = typ[-1].strip() if typ else "?"
        if typ_s in KEEP_TYPES:
            print(f"KEEP {typ_s}@{int(x)},{int(z)}")
            continue
        if abs(x - HUB[0]) < 1 and abs(z - HUB[1]) < 1:
            print(f"KEEP hub {typ_s}")
            continue
        to_delete.append(name)
        print(f"DELETE {typ_s}@{int(x)},{int(z)} dist={dist:.0f}")

    print(f"delete={len(to_delete)}")
    for i in range(0, len(to_delete), 25):
        chunk = to_delete[i : i + 25]
        joined = " ".join(f"'{REG}/{n}'" for n in chunk)
        wsl(f"rm -f {joined}")
    print("left", wsl(f"ls -1 '{REG}' | wc -l").strip())
    cfg = load_config()
    with RconClient(cfg.rcon) as client:
        print((client.command("cv reload") or "")[:120])


if __name__ == "__main__":
    main()

"""Wipe all Civs regions except town hub council_room; cv reload."""
from __future__ import annotations

import re
import subprocess

from qa_config import load_config
from rcon_client import RconClient

REG = "/home/dansilva/civs-testserver/plugins/Civs/regions"
HUB = (3000, 2600)
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
    keep = 0
    delete = 0
    for name in files:
        m = NAME_RE.search(name)
        typ = wsl(f"grep -m1 '^type:' '{REG}/{name}' | sed 's/^type: *//'").strip().splitlines()
        typ_s = typ[-1].strip() if typ else "?"
        if m:
            x, z = float(m.group(1)), float(m.group(3))
            if typ_s == "council_room" and abs(x - HUB[0]) < 2 and abs(z - HUB[1]) < 2:
                print("KEEP", typ_s, name)
                keep += 1
                continue
        wsl(f"rm -f '{REG}/{name}'")
        delete += 1
    print(f"deleted={delete} kept={keep} left={wsl(f'ls -1 {REG} | wc -l').strip()}")
    cfg = load_config()
    with RconClient(cfg.rcon) as client:
        print((client.command("cv reload") or "")[:120])


if __name__ == "__main__":
    main()

from build_reqs import load_item_groups, parse_build_reqs, plan_block_placements
from item_types import load_batch
from qa_config import load_config
from rcon_client import RconClient
from test_structures_fast import rcon_fill_build_reqs, _rcon_ok
import subprocess

cfg = load_config()
g = load_item_groups(cfg.civs_repo / "Civs_servidor" / "config.yml")
it = load_batch(cfg.item_types_dir, ["gravel_quarry"])[0][0]
cx, cy, cz = 4700, 81, 4700
r = 3
pl = plan_block_placements(cx, cy, cz, r, parse_build_reqs(it.build_reqs, g))
print("pl sample", pl[:10], "...", len(pl))
with RconClient(cfg.rcon) as client:
    _rcon_ok(client, "clear @p")
    print(rcon_fill_build_reqs(client, cx, cy, cz, r, pl))
    _rcon_ok(client, f"tp @p {cx + 0.5} {cy + 2} {cz + 0.5}")
    print(_rcon_ok(client, "cv give Smokeshow gravel_quarry 1"))
    print(_rcon_ok(client, f"cv placeregion Smokeshow gravel_quarry {cx} {cy} {cz}"))

out = subprocess.check_output(
    [
        "wsl",
        "bash",
        "-lc",
        "grep -h '^type:' /home/dansilva/civs-testserver/plugins/Civs/regions/*.yml | sort | uniq -c | sort -rn | head -25",
    ],
    text=True,
)
print(out)

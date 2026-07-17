#!/bin/bash
# Emergency UX rollback: kill hearts-slot + hide-hearts; vanilla hearts + Civs mana BossBar.
set -euo pipefail
TS=$(date +%Y%m%d%H%M%S)
CIVS=/home/daniel/mineserver/plugins/Civs/config.yml
RPG=/home/daniel/mineserver/plugins/RPGServer/config.yml
AURA=/home/daniel/mineserver/plugins/AuraSkills/config.yml

cp -a "$CIVS" "$CIVS.bak.hud-ux-$TS"
cp -a "$RPG" "$RPG.bak.hud-ux-$TS"
[[ -f "$AURA" ]] && cp -a "$AURA" "$AURA.bak.hud-ux-$TS"

python3 - <<'PY'
from pathlib import Path
import re

civs = Path("/home/daniel/mineserver/plugins/Civs/config.yml")
text = civs.read_text(encoding="utf-8")
text2, n = re.subn(r"(?m)^mana-hud:\s*\S+", "mana-hud: bossbar", text, count=1)
if n == 0:
    raise SystemExit("Civs mana-hud key missing")
civs.write_text(text2, encoding="utf-8")
print("Civs mana-hud -> bossbar")

rpg = Path("/home/daniel/mineserver/plugins/RPGServer/config.yml")
text = rpg.read_text(encoding="utf-8")

def set_nested(src: str, pattern: str, replacement: str, label: str) -> str:
    out, n = re.subn(pattern, replacement, src, count=1, flags=re.M)
    print(f"{label}: {'ok' if n else 'MISSING'}")
    return out if n else src

# composed.enabled false
text = set_nested(
    text,
    r"(hud:\n(?:  .*\n)*?  composed:\n(?:    .*\n)*?    enabled:\s*)(true|false)",
    r"\1false",
    "RPG hud.composed.enabled -> false",
)
text = set_nested(
    text,
    r"(hud:\n(?:  .*\n)*?  composed:\n(?:    .*\n)*?    layout:\s*)\S+",
    r"\1legacy",
    "RPG hud.composed.layout -> legacy",
)
# mana-only format (no HP duplication)
text = set_nested(
    text,
    r'(    format:\s*)"[^"]*"',
    r'\1"<aqua>✦ %civs_mana_pair%</aqua>"',
    "RPG composed format -> mana-only",
)
text = set_nested(
    text,
    r"(hide-vanilla-hearts:\n(?:    .*\n)*?    enabled:\s*)(true|false)",
    r"\1false",
    "RPG hide-vanilla-hearts.enabled -> false",
)
text = set_nested(
    text,
    r"(hide-vanilla-hearts:\n(?:    .*\n)*?    force:\s*)(true|false)",
    r"\1false",
    "RPG hide-vanilla-hearts.force -> false",
)
rpg.write_text(text, encoding="utf-8")

aura = Path("/home/daniel/mineserver/plugins/AuraSkills/config.yml")
if aura.exists():
    text = aura.read_text(encoding="utf-8")
    # With Civs on BossBar, AuraSkills idle ActionBar is fine again.
    m = re.search(r"(action_bar:\n(?:  .*\n)*?  idle:\s*)(true|false)", text)
    if m:
        text = text[: m.start(2)] + "true" + text[m.end(2) :]
        aura.write_text(text, encoding="utf-8")
        print("AuraSkills action_bar.idle -> true")
    else:
        print("AuraSkills action_bar.idle: MISSING")
PY

echo "--- verify ---"
grep -nE "mana-hud|layout:|enabled:|force:|idle:" "$CIVS" "$RPG" "$AURA" 2>/dev/null | head -50
echo "regions=$(ls /home/daniel/mineserver/plugins/Civs/regions | wc -l) towns=$(ls /home/daniel/mineserver/plugins/Civs/towns | wc -l) players=$(ls /home/daniel/mineserver/plugins/Civs/players | wc -l)"
echo "HUD_UX_ROLLBACK_OK"

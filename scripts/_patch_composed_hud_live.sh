#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d%H%M%S)
CIVS=/home/daniel/mineserver/plugins/Civs/config.yml
RPG=/home/daniel/mineserver/plugins/RPGServer/config.yml
AURA=/home/daniel/mineserver/plugins/AuraSkills/config.yml

cp -a "$CIVS" "$CIVS.bak.composed-$TS"
cp -a "$RPG" "$RPG.bak.composed-$TS"
cp -a "$AURA" "$AURA.bak.composed-$TS"

python3 - <<'PY'
from pathlib import Path
import re

# Civs: mana-hud composed
civs = Path("/home/daniel/mineserver/plugins/Civs/config.yml")
text = civs.read_text(encoding="utf-8")
text2, n = re.subn(r"(?m)^mana-hud:\s*\S+", "mana-hud: composed", text, count=1)
if n == 0:
    raise SystemExit("mana-hud key missing")
civs.write_text(text2, encoding="utf-8")
print("Civs mana-hud -> composed")

# AuraSkills: disable idle ActionBar (keep ability messages)
aura = Path("/home/daniel/mineserver/plugins/AuraSkills/config.yml")
text = aura.read_text(encoding="utf-8")
# only under action_bar block — replace first idle: true after action_bar:
m = re.search(r"(action_bar:\n(?:  .*\n)*?  idle:\s*)(true|false)", text)
if not m:
    raise SystemExit("AuraSkills action_bar.idle missing")
text = text[:m.start(2)] + "false" + text[m.end(2):]
aura.write_text(text, encoding="utf-8")
print("AuraSkills action_bar.idle -> false")

# RPG: ensure composed hud + chat transient
rpg = Path("/home/daniel/mineserver/plugins/RPGServer/config.yml")
text = rpg.read_text(encoding="utf-8")
if "hud:" not in text or "composed:" not in text:
    insert = """
# Unified ActionBar (RPG owns it)
hud:
  composed:
    enabled: true
    interval-ticks: 10
    format: "<red>❤ %auraskills_hp%/%auraskills_hp_max%</red> <dark_gray>|</dark_gray> <aqua>✦ %civs_mana_pair%</aqua> <dark_gray>|</dark_gray> <gold>{quest}</gold>"
"""
    # insert before messages:
    if "\nmessages:" in text:
        text = text.replace("\nmessages:", insert + "\nmessages:", 1)
    else:
        text += insert
    print("RPG inserted hud.composed block")
else:
    text = re.sub(r"(?m)^(\s*enabled:\s*)(false|true)", r"\1true", text, count=1) if False else text
    # set composed.enabled true
    text2, n = re.subn(
        r"(hud:\n(?:  .*\n)*?  composed:\n(?:    .*\n)*?    enabled:\s*)(true|false)",
        r"\1true",
        text,
        count=1,
    )
    if n:
        text = text2
        print("RPG hud.composed.enabled -> true")
    else:
        print("RPG composed block present (enabled patch skipped)")

text2, n = re.subn(r"(?m)^(\s*transient-channel:\s*)\S+", r"\1chat", text, count=1)
if n:
    text = text2
    print("RPG transient-channel -> chat")
rpg.write_text(text, encoding="utf-8")
PY

echo "--- verify ---"
grep -nE "mana-hud|transient-channel|idle:" "$CIVS" "$RPG" "$AURA" | head -40
grep -A8 "^hud:" "$RPG" | head -20
echo "regions=$(ls /home/daniel/mineserver/plugins/Civs/regions | wc -l) towns=$(ls /home/daniel/mineserver/plugins/Civs/towns | wc -l) players=$(ls /home/daniel/mineserver/plugins/Civs/players | wc -l)"

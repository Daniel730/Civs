#!/bin/bash
set -euo pipefail
CIVS=/home/daniel/mineserver/plugins/Civs/config.yml
RPG=/home/daniel/mineserver/plugins/RPGServer/config.yml
TS=$(date +%Y%m%d%H%M%S)
cp -a "$CIVS" "$CIVS.bak.hud-$TS"
cp -a "$RPG" "$RPG.bak.hud-$TS"

python3 - <<'PY'
from pathlib import Path
import re

civs = Path("/home/daniel/mineserver/plugins/Civs/config.yml")
text = civs.read_text(encoding="utf-8")
if "mana-hud:" not in text:
    needle = "use-classes-and-spells: true\n"
    insert = needle + (
        "# Mana HUD: auto = BossBar when AuraSkills present (avoids ActionBar fight)\n"
        "# Options: auto | actionbar | bossbar | when-needed | off\n"
        "mana-hud: auto\n"
        "region-upkeep-chat-tips: true\n"
        "region-upkeep-tip-cooldown-seconds: 300\n"
    )
    if needle not in text:
        raise SystemExit("Civs needle missing")
    civs.write_text(text.replace(needle, insert, 1), encoding="utf-8")
    print("Civs: inserted mana-hud")
else:
    print("Civs: mana-hud already present")

rpg = Path("/home/daniel/mineserver/plugins/RPGServer/config.yml")
text = rpg.read_text(encoding="utf-8")
if "transient-channel:" not in text:
    m = re.search(r"(^[ \t]*tracked-hud:.*\n)", text, re.M)
    if not m:
        raise SystemExit("RPG tracked-hud missing")
    insert = (
        m.group(1)
        + "  # Short quest pulses: auto = chat when AuraSkills present\n"
        + "  # Options: auto | chat | actionbar | none\n"
        + "  transient-channel: auto\n"
    )
    text = text[:m.start()] + insert + text[m.end():]
    rpg.write_text(text, encoding="utf-8")
    print("RPG: inserted transient-channel")
else:
    print("RPG: transient-channel already present")
PY

# Patch PT/EN translation keys without wiping files
python3 - <<'PY'
from pathlib import Path

def upsert(path: Path, keys: dict):
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    existing = {}
    for i, line in enumerate(lines):
        if ":" in line and not line.lstrip().startswith("#"):
            key = line.split(":", 1)[0].strip()
            if key in keys:
                existing[key] = i
    for key, value in keys.items():
        entry = f'{key}: {value}\n'
        if key in existing:
            lines[existing[key]] = entry
        else:
            lines.append(entry if lines and lines[-1].endswith("\n") else "\n" + entry)
    path.write_text("".join(lines), encoding="utf-8")
    print(f"patched {path}")

en = {
    "region-upkeep-missing": '"$1 is stuck — put $2 in the input chest (tools/seeds/fuel)."',
    "region-upkeep-output-full": '"$1 is stuck — empty the output chest so it can deposit."',
    "class-menu-equip-tip": '"Click to switch class. Equip spells in the class menu, then /cv spells for the combat bar."',
    "spell-command": '"Equip spells in empty slots, then /cv spells to put them on your hotbar."',
    "switch-spell-cast": '"Hold this item and right-click to cast."',
    "empty-spell-slot-desc": '"Left-click to pick a spell for this slot. Then use /cv spells."',
}
pt = {
    "region-upkeep-missing": '"$1 parou — coloque $2 no baú de entrada (ferramentas/sementes/combustível)."',
    "region-upkeep-output-full": '"$1 parou — esvazie o baú de saída para depositar."',
    "class-menu-equip-tip": '"Clique para trocar de classe. Equipe magias no menu da classe e use /cv spells para a barra de combate."',
    "spell-command": "Equipe magias nos slots vazios e use /cv spells para colocá-las na hotbar.",
    "switch-spell-cast": "Segure este item e clique direito para lançar.",
    "empty-spell-slot-desc": "Clique esquerdo para escolher uma magia neste slot. Depois use /cv spells.",
    "need-more-mana": "Você precisa de mais $1 de $2 para fazer isso",
}
upsert(Path("/home/daniel/mineserver/plugins/Civs/translations/en.yml"), en)
upsert(Path("/home/daniel/mineserver/plugins/Civs/translations/pt_br.yml"), pt)
PY

echo "--- verify ---"
grep -nE "mana-hud|region-upkeep|transient-channel" "$CIVS" "$RPG" | head -20
ls -la /home/daniel/mineserver/plugins/civs-1.11.7.jar /home/daniel/mineserver/plugins/rpg-server-0.1.2.jar
# Do not delete regions/towns/players
echo "regions=$(ls /home/daniel/mineserver/plugins/Civs/regions 2>/dev/null | wc -l) towns=$(ls /home/daniel/mineserver/plugins/Civs/towns 2>/dev/null | wc -l) players=$(ls /home/daniel/mineserver/plugins/Civs/players 2>/dev/null | wc -l)"

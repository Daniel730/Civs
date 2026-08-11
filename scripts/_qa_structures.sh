#!/usr/bin/env bash
# WorldEdit + structure QA infrastructure — builds platforms, runs console checks.
set -euo pipefail
SESSION=civs-qa
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
BP="${CIVS_TESTSERVER:-$HOME/civs-testserver}/plugins/Civs/blueprints"
REG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/plugins/Civs/regions"
MARK="QA_STRUCT_$(date +%H%M%S)"

run() {
  echo "> $*"
  tmux send-keys -t "$SESSION" "$*" Enter
  sleep 2
}

# QA build grid origin (flat area away from guide NPCs)
BX=2100
BY=80
BZ=2100

echo "=== STRUCTURE QA $MARK ==="

# Prep player
run "gamemode creative Smokeshow"
run "tp Smokeshow $BX $((BY+1)) $BZ"
run "time set day"
run "weather clear"

# --- Platform A: main build plateau (50x50 grass + stone border) ---
run "fill $BX $BY $BZ $((BX+49)) $BY $((BZ+49)) grass_block"
run "fill $BX $BY $BZ $((BX+49)) $BY $((BZ+49)) stone replace air"
run "fill $BX $((BY+1)) $BZ $((BX+49)) $((BY+1)) $((BZ+49)) air"

# --- Sub-pads for structure categories (labeled with signs via setblock later) ---
# Farms pad
run "fill $((BX+2)) $BY $((BZ+2)) $((BX+15)) $BY $((BZ+15)) farmland"
run "fill $((BX+2)) $((BY+1)) $((BZ+2)) $((BX+15)) $((BY+1)) $((BZ+15)) air"
run "setblock $((BX+2)) $((BY+1)) $((BZ+2)) oak_sign[rotation=0]{Text1:'{\"text\":\"FARMS QA\"}'}"

# Defense/turret pad
run "fill $((BX+20)) $BY $((BZ+2)) $((BX+30)) $BY $((BZ+12)) stone_bricks"
run "setblock $((BX+20)) $((BY+1)) $((BZ+2)) oak_sign[rotation=0]{Text1:'{\"text\":\"DEFENSE QA\"}'}"

# Housing pad
run "fill $((BX+2)) $BY $((BZ+20)) $((BX+15)) $BY $((BZ+35)) oak_planks"
run "setblock $((BX+2)) $((BY+1)) $((BZ+20)) oak_sign[rotation=0]{Text1:'{\"text\":\"HOUSING QA\"}'}"

# Utilities/town pad
run "fill $((BX+20)) $BY $((BZ+20)) $((BX+35)) $BY $((BZ+35)) polished_andesite"
run "setblock $((BX+20)) $((BY+1)) $((BZ+20)) oak_sign[rotation=0]{Text1:'{\"text\":\"UTILITIES QA\"}'}"

# Production/factories pad
run "fill $((BX+37)) $BY $((BZ+2)) $((BX+49)) $BY $((BZ+15)) smooth_stone"
run "setblock $((BX+37)) $((BY+1)) $((BZ+2)) oak_sign[rotation=0]{Text1:'{\"text\":\"FACTORIES QA\"}'}"

# Mines/quarries pad (deeper)
run "fill $((BX+37)) $((BY-5)) $((BZ+20)) $((BX+49)) $BY $((BZ+35)) deepslate"
run "setblock $((BX+37)) $((BY+1)) $((BZ+20)) oak_sign[rotation=0]{Text1:'{\"text\":\"MINES QA\"}'}"

# --- WorldEdit test via player (may fail if execute broken) ---
run "execute as Smokeshow at @s run //wand"
run "execute as Smokeshow at @s positioned $((BX+40)) $BY $((BZ+40)) run //pos1"
run "execute as Smokeshow at @s positioned $((BX+45)) $BY $((BZ+45)) run //pos2"
run "execute as Smokeshow at @s run //set gold_block"

# Tutorial progression + newday cycles
for i in 1 2 3 4 5; do
  run "cv advancetut Smokeshow"
done
run "cv newday"
run "cv newday"
run "cv reload"

run "say QA $MARK: Platform at $BX $BY $BZ — use //wand, buy shop items, place structures"

echo "=== BLUEPRINTS ON DISK ==="
ls -la "$BP" 2>/dev/null || echo "(no blueprints dir)"
echo "=== REGIONS COUNT ==="
ls "$REG" 2>/dev/null | wc -l || echo 0
echo "=== LOG TAIL ==="
tail -60 "$LOG"
echo "=== STRUCTURE ERRORS ==="
grep -iE 'region|placement|blueprint|instant|build-req|upkeep|WorldEdit|structure' "$LOG" | grep -iE 'ERROR|SEVERE|WARN|fail|invalid' | tail -30 || echo "(none)"

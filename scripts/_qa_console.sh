#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTL="$SCRIPT_DIR/_tmux_server.sh"
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"

"$CTL" start
"$CTL" wait-boot

run() { echo "> $*"; "$CTL" cmd "$@"; sleep 2; }

run "op QA-Bot"
run "whitelist off"
run "cv reload"
run "rpg reload"
run "list"

echo "== boot highlights =="
grep -iE 'Civs Version|RPGServer habilitado|Hooked into Economy|TestEconomy|WorldEdit|Null world|Loaded 7 custom|Loaded 4 guide|mana|bossbar|AuraSkills|ERROR|SEVERE' "$LOG" | tail -50 || true

echo "== civs/rpg errors =="
grep -iE 'ERROR|SEVERE|Exception' "$LOG" | grep -iE 'Civs|RPGServer|WorldEdit|TestEconomy|custom|spell|farm|menu|mob' | tail -30 || echo "(none)"

echo "QA_CONSOLE_DONE"

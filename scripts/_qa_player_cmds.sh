#!/usr/bin/env bash
# Player-as QA commands via execute
set -euo pipefail
SESSION=civs-qa
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
MARK="QA_PLAYER_$(date +%H%M%S)"

run() {
  echo "> $*"
  tmux send-keys -t "$SESSION" "$*" Enter
  sleep 3
}

echo "=== $MARK ==="
run "gamemode creative Smokeshow"
run "execute as Smokeshow run cv mob spawn guild_thief"
run "execute as Smokeshow run cv mob spawn wild_boar"
run "execute as Smokeshow run cv mob list"
run "execute as Smokeshow run cv menu"
run "execute as Smokeshow run cv spells"
run "execute as Smokeshow run rpg hub"
run "execute as Smokeshow run rpg journal"
run "cv advancetut Smokeshow"
run "execute as Smokeshow run cv"

echo "=== LOG AFTER $MARK ==="
grep "$MARK" "$LOG" || true
tail -80 "$LOG"

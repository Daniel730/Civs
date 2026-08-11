#!/usr/bin/env bash
# One-shot QA audit console commands — document only, no fixes.
set -euo pipefail
SESSION=civs-qa
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
MARKER="QA_AUDIT_$(date +%H%M%S)"

run() {
  echo "> $*"
  tmux send-keys -t "$SESSION" "$*" Enter
  sleep 2
}

echo "=== QA AUDIT START $MARKER ==="
run "op Smokeshow"
run "gamemode creative Smokeshow"
run "money give Smokeshow 1000000"
run "list"
run "cv reload"
run "rpg reload"

# Custom mobs (all 7)
for mob in guild_thief wild_boar stone_golem bandit_scout bandit_chief sand_raider frost_wraith; do
  run "cv mob spawn $mob Smokeshow"
done

# Console-only civs/rpg checks
run "cv advancetut Smokeshow"
run "cv newday"
run "help cv"
run "help rpg"
run "plugins"

# Teleport Smokeshow near guide NPCs (spawn area ~2030,-2010)
run "tp Smokeshow 2030 68 -2010"
run "say QA_AUDIT: Smokeshow at guide NPCs — please interact manually"

echo "=== LOG SNIPPET AFTER $MARKER ==="
grep -n "$MARKER" "$LOG" || true
tail -120 "$LOG"

echo "=== ERRORS (civs/rpg) ==="
grep -iE 'ERROR|SEVERE|Exception|WARN.*Civs|WARN.*RPG' "$LOG" | tail -60 || true

echo "=== QA AUDIT DONE ==="

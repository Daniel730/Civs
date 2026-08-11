#!/usr/bin/env bash
SESSION=civs-qa
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
run(){ echo "> $1"; tmux send-keys -t "$SESSION" "$1" Enter; sleep 3; }
run "execute as Smokeshow run worldedit wand"
run "execute as Smokeshow run worldedit:worldedit wand"
run "execute as Smokeshow run we wand"
tail -20 "$LOG"

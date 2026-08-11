#!/usr/bin/env bash
# Recover Paper QA NPC overnight worker (disposable WSL only).
set -eu
export PATH="${HOME}/.nvm/versions/node/v25.8.0/bin:${PATH}"
ROOT="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner"
cd "$ROOT"
if ! tmux has-session -t civs-qa 2>/dev/null; then
  echo "BLOCKED: civs-qa tmux missing — start Paper first"
  exit 2
fi
tmux kill-session -t village-npc 2>/dev/null || true
sleep 1
tmux new-session -d -s village-npc \
  "RCON_PASSWORD=civsqa ENABLE_HELPER=1 FORCE_ORBIT=1 node scripts/village-worker.js 2>&1 | tee -a reports/village-worker.log"
echo "PASS: village-npc restarted"
tmux ls

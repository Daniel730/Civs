#!/usr/bin/env bash
set -euo pipefail
SERVER="${CIVS_TESTSERVER:-$HOME/civs-testserver}"
LOG="$SERVER/logs/latest.log"
for i in $(seq 1 90); do
  if [[ -f "$LOG" ]] && grep -q 'Done (' "$LOG" 2>/dev/null; then
    echo "BOOT_OK after $((i*10))s"
    exit 0
  fi
  sleep 10
done
echo "BOOT_TIMEOUT"
tail -30 "$SERVER/server-console.log" 2>/dev/null || true
exit 1

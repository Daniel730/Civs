#!/usr/bin/env bash
# Send console commands to a running Paper server via FIFO (start server with _run_testserver.sh).
set -euo pipefail
SERVER="${CIVS_TESTSERVER:-$HOME/civs-testserver}"
FIFO="$SERVER/console.fifo"
if [[ ! -p "$FIFO" ]]; then
  echo "FIFO missing — is server running via _run_testserver.sh?"
  exit 1
fi
while IFS= read -r cmd; do
  [[ -z "$cmd" || "$cmd" == \#* ]] && continue
  echo "> $cmd"
  echo "$cmd" > "$FIFO"
  sleep 1
done < "${1:-/dev/stdin}"

#!/usr/bin/env bash
set -euo pipefail
SERVER="${CIVS_TESTSERVER:-$HOME/civs-testserver}"
FIFO="$SERVER/console.fifo"
LOG="$SERVER/server-console.log"
mkdir -p "$SERVER"
rm -f "$FIFO"
mkfifo "$FIFO"
cd "$SERVER"
(
  while true; do cat "$FIFO"; done
) | java -Xmx2G -jar paper.jar --nogui 2>&1 | tee -a "$LOG"

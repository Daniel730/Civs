#!/usr/bin/env bash
# Civs QA test server control via tmux session "civs-qa".
set -euo pipefail
SERVER="${CIVS_TESTSERVER:-$HOME/civs-testserver}"
SESSION=civs-qa
LOG="$SERVER/logs/latest.log"

case "${1:-status}" in
  start)
    mkdir -p "$SERVER"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "Session $SESSION already running"
      exit 0
    fi
    tmux new-session -d -s "$SESSION" "cd '$SERVER' && exec java -Xmx2G -jar paper.jar --nogui"
    echo "Started tmux session $SESSION"
    ;;
  stop)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux send-keys -t "$SESSION" "stop" Enter
      for i in $(seq 1 30); do
        tmux has-session -t "$SESSION" 2>/dev/null || break
        sleep 2
      done
      tmux kill-session -t "$SESSION" 2>/dev/null || true
    fi
    echo "Stopped"
    ;;
  cmd)
    shift
    [[ $# -gt 0 ]] || { echo "usage: $0 cmd <command...>"; exit 1; }
    tmux send-keys -t "$SESSION" "$*" Enter
    ;;
  wait-boot)
    # Prefer a Done line newer than process start; fall back to RCON listener line
    # so a stale latest.log from a previous run cannot false-positive.
    start_epoch=$(date +%s)
    for i in $(seq 1 90); do
      if [[ -f "$LOG" ]]; then
        if grep -q 'RCON running on' "$LOG" 2>/dev/null; then
          # Ensure the log was touched after we started waiting (restart-safe).
          log_mtime=$(stat -c %Y "$LOG" 2>/dev/null || stat -f %m "$LOG" 2>/dev/null || echo 0)
          if [[ "$log_mtime" -ge $((start_epoch - 5)) ]] && grep -q 'Done (' "$LOG" 2>/dev/null; then
            echo "BOOT_OK"
            exit 0
          fi
        fi
      fi
      sleep 5
    done
    echo "BOOT_TIMEOUT"
    exit 1
    ;;
  log)
    tail -n "${2:-50}" "$LOG" 2>/dev/null || true
    ;;
  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then echo RUNNING; else echo STOPPED; fi
    ;;
  *)
    echo "usage: $0 {start|stop|cmd|wait-boot|log|status}"
    exit 1
    ;;
esac

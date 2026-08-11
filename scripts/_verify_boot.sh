#!/bin/bash
set -euo pipefail
LOG=/home/daniel/mineserver/logs/latest.log
for n in $(seq 1 40); do
  if grep -q 'Done (' "$LOG" 2>/dev/null; then
    echo BOOT_DONE
    break
  fi
  echo "wait_$n"
  sleep 5
done
echo '--- plugin lines ---'
grep -E 'Done \(|\[Civs\]|\[RPGServer\]|AuraSkills API|Hooked into|ERROR\]|Exception' "$LOG" | tail -80 || true
echo '--- data preserved ---'
echo "regions=$(ls /home/daniel/mineserver/plugins/Civs/regions 2>/dev/null | wc -l)"
echo "towns=$(ls /home/daniel/mineserver/plugins/Civs/towns 2>/dev/null | wc -l)"
echo "players=$(ls /home/daniel/mineserver/plugins/Civs/players 2>/dev/null | wc -l)"
echo '--- config ---'
grep -nE 'mana-hud|transient-channel' /home/daniel/mineserver/plugins/Civs/config.yml /home/daniel/mineserver/plugins/RPGServer/config.yml

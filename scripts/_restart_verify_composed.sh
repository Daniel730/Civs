#!/bin/bash
set -euo pipefail
for n in $(seq 1 24); do
  if ! pgrep -f '/opt/java25/bin/java -Xms4G' >/dev/null 2>&1; then
    echo STOPPED
    break
  fi
  echo "wait_stop_$n"
  sleep 5
done
cd /home/daniel/mineserver
tmux -L mc has-session -t minecraft 2>/dev/null && tmux -L mc kill-session -t minecraft || true
tmux -L mc new-session -d -s minecraft '/opt/java25/bin/java -Xms4G -Xmx4G -jar server.jar nogui'
echo STARTED
LOG=/home/daniel/mineserver/logs/latest.log
for n in $(seq 1 40); do
  if grep -q 'Done (' "$LOG" 2>/dev/null; then
    echo BOOT_DONE
    break
  fi
  echo "wait_boot_$n"
  sleep 5
done
grep -E 'Done \(|HUD composto|Civs\]|RPGServer\]|AuraSkills API' "$LOG" | tail -40
echo "regions=$(ls /home/daniel/mineserver/plugins/Civs/regions | wc -l) towns=$(ls /home/daniel/mineserver/plugins/Civs/towns | wc -l) players=$(ls /home/daniel/mineserver/plugins/Civs/players | wc -l)"

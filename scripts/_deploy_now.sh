#!/usr/bin/env bash
set -euo pipefail
HOST=daniel@bot-server
SERVER=/home/daniel/mineserver
PLUGINS="$SERVER/plugins"
SCRIPT=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/scripts/mineserver-control-remote.sh
CIVS_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/target/civs-1.11.7.jar
RPG_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/target/rpg-server-0.1.2.jar
CIVS_CFG=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/Civs_servidor

test -f "$CIVS_JAR"
test -f "$RPG_JAR"
test -f "$SCRIPT"

echo "== server state =="
ssh -o BatchMode=yes "$HOST" "tmux -L mc list-sessions 2>&1; pgrep -af server.jar || true; ls -la $PLUGINS/civs*.jar $PLUGINS/rpg*.jar 2>&1 || true"

echo "== stop if running =="
ssh -o BatchMode=yes "$HOST" 'bash -s' -- stop < "$SCRIPT" || true

echo "== sync key configs (tar, no live data wipe) =="
(
  cd "$CIVS_CFG"
  tar -cf - translations/en.yml translations/pt_br.yml item-types/defense/bandit_camp.yml
) | ssh -o BatchMode=yes "$HOST" "cd $PLUGINS/Civs && tar -xvf -"

echo "== deploy jars =="
ssh -o BatchMode=yes "$HOST" "rm -f $PLUGINS/civs-*.jar $PLUGINS/rpg-server-*.jar"
scp -o BatchMode=yes "$CIVS_JAR" "${HOST}:${PLUGINS}/civs-1.11.7.jar"
scp -o BatchMode=yes "$RPG_JAR" "${HOST}:${PLUGINS}/rpg-server-0.1.2.jar"
ssh -o BatchMode=yes "$HOST" "ls -la $PLUGINS/civs-1.11.7.jar $PLUGINS/rpg-server-0.1.2.jar; sha256sum $PLUGINS/civs-1.11.7.jar $PLUGINS/rpg-server-0.1.2.jar; unzip -p $PLUGINS/civs-1.11.7.jar plugin.yml | head -8; unzip -p $PLUGINS/rpg-server-0.1.2.jar plugin.yml | head -8"

echo "== start =="
ssh -o BatchMode=yes "$HOST" 'bash -s' -- start < "$SCRIPT"

LOG="$SERVER/logs/latest.log"
for i in $(seq 1 60); do
  if ssh -o BatchMode=yes "$HOST" "grep -q 'Done (' \"$LOG\" 2>/dev/null"; then
    echo "SERVER_DONE after ${i}"
    break
  fi
  sleep 3
done
sleep 6
echo "== verification =="
ssh -o BatchMode=yes "$HOST" "tmux -L mc list-sessions; grep -iE 'Enabling Civs|Enabling RPG|Civs \\(|RPGServer|Done \\(' \"$LOG\" | tail -30; echo ---errors---; grep -E 'ERROR|Exception|NullPointer' \"$LOG\" | grep -iE 'civs|rpg|multitall|translation|bandit|barracks' | head -40 || true"
echo DEPLOY_OK

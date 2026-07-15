#!/usr/bin/env bash
set -euo pipefail
HOST=daniel@bot-server
SERVER=/home/daniel/mineserver
PLUGINS="$SERVER/plugins"
SCRIPT=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/scripts/mineserver-control-remote.sh
CIVS_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/target/civs-1.11.7.jar
RPG_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/target/rpg-server-0.1.2.jar
CIVS_CFG=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/Civs_servidor/
QUARANTINE="$SERVER/mineserver_cleanup_$(date +%Y%m%d_%H%M%S)"

test -f "$CIVS_JAR"
test -f "$RPG_JAR"
test -d "$CIVS_CFG"

echo "== stopping server =="
ssh -o BatchMode=yes "$HOST" 'bash -s' -- stop < "$SCRIPT"

echo "== quarantine backup =="
ssh -o BatchMode=yes "$HOST" "mkdir -p \"$QUARANTINE\" && cp -a \"$PLUGINS/Civs\" \"$QUARANTINE/Civs\" && cp -a \"$PLUGINS\"/civs-*.jar \"$QUARANTINE/\" 2>/dev/null || true && cp -a \"$PLUGINS\"/rpg-server-*.jar \"$QUARANTINE/\" 2>/dev/null || true"
echo "QUARANTINE=$QUARANTINE"

echo "== rsync Civs_servidor -> plugins/Civs =="
rsync -avz --delete \
  --exclude "towns/" \
  --exclude "regions/" \
  --exclude "players/" \
  --exclude "alliances/" \
  --exclude "block-data.yml" \
  "$CIVS_CFG" "${HOST}:${PLUGINS}/Civs/"

echo "== deploy JARs =="
ssh -o BatchMode=yes "$HOST" "rm -f \"$PLUGINS\"/civs-*.jar \"$PLUGINS\"/rpg-server-*.jar"
scp -o BatchMode=yes "$CIVS_JAR" "${HOST}:${PLUGINS}/civs-1.11.7.jar"
scp -o BatchMode=yes "$RPG_JAR" "${HOST}:${PLUGINS}/rpg-server-0.1.2.jar"

echo "== starting server =="
ssh -o BatchMode=yes "$HOST" 'bash -s' -- start < "$SCRIPT"

LOG="$SERVER/logs/latest.log"
for i in $(seq 1 90); do
  if ssh -o BatchMode=yes "$HOST" "grep -q 'Done (' \"$LOG\" 2>/dev/null"; then
    break
  fi
  sleep 3
done
sleep 8

echo "=== boot verification ==="
ssh -o BatchMode=yes "$HOST" "grep -iE 'Civs|RPGServer|custom mob|Carregad|Enabling|Done \\(' \"$LOG\" | tail -30"
echo "=== civs/rpg errors ==="
ssh -o BatchMode=yes "$HOST" "grep -E 'ERROR|ClassNotFoundException|NoClassDefFoundError' \"$LOG\" | grep -iE 'Civs|RPGServer|custom' | tail -15 || true"
echo "DEPLOY_OK quarantine=$QUARANTINE"

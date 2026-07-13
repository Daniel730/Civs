set -euo pipefail
HOST=daniel@bot-server
PLUGINS=/home/daniel/mineserver/plugins
CIVS_CFG=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/Civs_servidor
CIVS_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/target/civs-1.11.6.jar
RPG_JAR=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/target/rpg-server-0.1.0-SNAPSHOT.jar
SCRIPT=/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin/scripts/mineserver-control-remote.sh
QUARANTINE=/home/daniel/mineserver/mineserver_cleanup_20260705_091338

echo "== sync Civs_servidor via tar =="
(cd "$CIVS_CFG" && tar -cf - \
  --exclude=./towns \
  --exclude=./regions \
  --exclude=./players \
  --exclude=./alliances \
  --exclude=./block-data.yml \
  .) | ssh -o BatchMode=yes "$HOST" "mkdir -p \"$PLUGINS/Civs\" && cd \"$PLUGINS/Civs\" && tar -xf -"

echo "== deploy JARs =="
scp -o BatchMode=yes "$CIVS_JAR" "${HOST}:${PLUGINS}/civs-1.11.6.jar"
scp -o BatchMode=yes "$RPG_JAR" "${HOST}:${PLUGINS}/rpg-server-0.1.0-SNAPSHOT.jar"

echo "== starting server =="
ssh -o BatchMode=yes "$HOST" "bash -s" -- start < "$SCRIPT"

LOG=/home/daniel/mineserver/logs/latest.log
for i in $(seq 1 90); do
  if ssh -o BatchMode=yes "$HOST" "grep -q 'Done (' \"$LOG\" 2>/dev/null"; then break; fi
  sleep 3
done
sleep 8

echo "=== boot verification ==="
ssh -o BatchMode=yes "$HOST" "grep -iE 'Civs|RPGServer|custom mob|Carregad|Enabling|Done \\(' \"$LOG\" | tail -30"
echo "=== civs/rpg errors ==="
ssh -o BatchMode=yes "$HOST" "grep -E 'ERROR|ClassNotFoundException|NoClassDefFoundError' \"$LOG\" | grep -iE 'Civs|RPGServer|custom' | tail -15 || true"
echo "DEPLOY_OK quarantine=$QUARANTINE"
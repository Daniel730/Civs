#!/usr/bin/env bash
LOG="${CIVS_TESTSERVER:-$HOME/civs-testserver}/logs/latest.log"
echo "=== BOOT (first 60 lines) ==="
head -60 "$LOG"
echo "=== NULL WORLD count ==="
grep -c 'Null world' "$LOG" || true
grep 'Null world' "$LOG" | head -3
echo "=== CIVS errors/warnings ==="
grep -iE '\[Civs\]|Civs.*(ERROR|SEVERE|WARN)' "$LOG" | grep -iv reloaded | tail -50
echo "=== RPG errors ==="
grep -iE 'RPGServer.*(ERROR|SEVERE|Exception)|Command exception' "$LOG" | tail -30
echo "=== GAMEMODE ==="
grep -i gamemode "$LOG" | tail -5
echo "=== ADVANCETUT ==="
grep -i advancetut "$LOG" | tail -5
echo "=== ECONOMY ==="
grep -iE 'money|economy|TestEconomy|balance' "$LOG" | tail -15
echo "=== INVALID REGION ==="
grep -iE 'invalid region|unable to load' "$LOG" | head -10
echo "=== SPELL/MANA/HUD ==="
grep -iE 'spell|mana|bossbar|composed|hearts' "$LOG" | tail -20
echo "=== WORLDEDIT ==="
grep -i worldedit "$LOG" | tail -10

#!/usr/bin/env bash
# Isolated Civs+RPG QA test server in WSL (Paper 26.1.2 / Java 25).
set -euo pipefail

TS="$(date +%Y%m%d_%H%M%S)"
SERVER="${CIVS_TESTSERVER:-$HOME/civs-testserver}"
CIVS_REPO="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6"
RPG_REPO="/mnt/c/Users/Danie/Downloads/Civs-1.11.6/rpg-server-plugin"
CIVS_JAR="$CIVS_REPO/target/civs-1.11.7.jar"
RPG_JAR="$RPG_REPO/target/rpg-server-0.1.2.jar"
CIVS_CFG="$CIVS_REPO/Civs_servidor"
PAPER_BUILD=72
PAPER_URL="$(curl -fsSL "https://fill.papermc.io/v3/projects/paper/versions/26.1.2/builds/${PAPER_BUILD}" | python3 -c "import json,sys; print(json.load(sys.stdin)['downloads']['server:default']['url'])")"
VAULT_URL="https://github.com/MilkBowl/Vault/releases/download/1.7.3/Vault.jar"
WE_URL="https://cdn.modrinth.com/data/1u6JkXh5/versions/yDUBafTJ/worldedit-bukkit-7.4.3.jar"

test -f "$CIVS_JAR" || { echo "Missing $CIVS_JAR — run mvn package in Civs"; exit 1; }
test -f "$RPG_JAR" || { echo "Missing $RPG_JAR — run mvn package in RPG"; exit 1; }
test -d "$CIVS_CFG" || { echo "Missing $CIVS_CFG"; exit 1; }

echo "== testserver at $SERVER =="
mkdir -p "$SERVER/plugins" "$SERVER/plugins/Civs"

echo "== Paper 26.1.2 build $PAPER_BUILD =="
if [[ ! -f "$SERVER/paper.jar" ]]; then
  curl -fsSL "$PAPER_URL" -o "$SERVER/paper.jar"
fi

echo "== Vault =="
if [[ ! -f "$SERVER/plugins/Vault.jar" ]]; then
  curl -fsSL "$VAULT_URL" -o "$SERVER/plugins/Vault.jar"
fi

echo "== WorldEdit 7.4.3 =="
if [[ ! -f "$SERVER/plugins/worldedit-bukkit-7.4.3.jar" ]]; then
  curl -fsSL "$WE_URL" -o "$SERVER/plugins/worldedit-bukkit-7.4.3.jar"
fi

echo "== TestEconomy stub =="
TE_DIR="$SERVER/_build/TestEconomy"
mkdir -p "$TE_DIR/src/main/java/dev/daniel730/testeconomy" "$TE_DIR/src/main/resources"
if [[ ! -f "$SERVER/plugins/TestEconomy.jar" ]]; then
  cat > "$TE_DIR/src/main/java/dev/daniel730/testeconomy/TestEconomy.java" <<'JAVA'
package dev.daniel730.testeconomy;

import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import org.bukkit.OfflinePlayer;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class TestEconomy extends JavaPlugin {
    private final ConcurrentHashMap<UUID, Double> balances = new ConcurrentHashMap<>();

    @Override
    public void onEnable() {
        getServer().getServicesManager().register(Economy.class, new Economy() {
            private double bal(OfflinePlayer p) {
                return balances.computeIfAbsent(p.getUniqueId(), k -> 1_000_000.0);
            }
            private void set(OfflinePlayer p, double v) { balances.put(p.getUniqueId(), Math.max(0, v)); }

            @Override public boolean isEnabled() { return true; }
            @Override public String getName() { return "TestEconomy"; }
            @Override public boolean hasBankSupport() { return false; }
            @Override public int fractionalDigits() { return 2; }
            @Override public String format(double amount) { return String.format("$%.2f", amount); }
            @Override public String currencyNamePlural() { return "coins"; }
            @Override public String currencyNameSingular() { return "coin"; }
            @Override public boolean hasAccount(String name) { return true; }
            @Override public boolean hasAccount(OfflinePlayer p) { return true; }
            @Override public boolean hasAccount(String name, String world) { return true; }
            @Override public boolean hasAccount(OfflinePlayer p, String world) { return true; }
            @Override public double getBalance(String name) { return 1_000_000; }
            @Override public double getBalance(OfflinePlayer p) { return bal(p); }
            @Override public double getBalance(String name, String world) { return getBalance(name); }
            @Override public double getBalance(OfflinePlayer p, String world) { return getBalance(p); }
            @Override public boolean has(String name, double amount) { return getBalance(name) >= amount; }
            @Override public boolean has(OfflinePlayer p, double amount) { return getBalance(p) >= amount; }
            @Override public boolean has(String name, String world, double amount) { return has(name, amount); }
            @Override public boolean has(OfflinePlayer p, String world, double amount) { return has(p, amount); }
            @Override public EconomyResponse withdrawPlayer(String name, double amount) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.FAILURE, "offline"); }
            @Override public EconomyResponse withdrawPlayer(OfflinePlayer p, double amount) {
                double b = bal(p); if (b < amount) return new EconomyResponse(0, b, EconomyResponse.ResponseType.FAILURE, "Insufficient funds");
                set(p, b - amount); return new EconomyResponse(amount, bal(p), EconomyResponse.ResponseType.SUCCESS, null);
            }
            @Override public EconomyResponse withdrawPlayer(String name, String world, double amount) { return withdrawPlayer(name, amount); }
            @Override public EconomyResponse withdrawPlayer(OfflinePlayer p, String world, double amount) { return withdrawPlayer(p, amount); }
            @Override public EconomyResponse depositPlayer(String name, double amount) { return new EconomyResponse(amount, 1_000_000, EconomyResponse.ResponseType.SUCCESS, null); }
            @Override public EconomyResponse depositPlayer(OfflinePlayer p, double amount) {
                set(p, bal(p) + amount); return new EconomyResponse(amount, bal(p), EconomyResponse.ResponseType.SUCCESS, null);
            }
            @Override public EconomyResponse depositPlayer(String name, String world, double amount) { return depositPlayer(name, amount); }
            @Override public EconomyResponse depositPlayer(OfflinePlayer p, String world, double amount) { return depositPlayer(p, amount); }
            @Override public EconomyResponse createBank(String name, String player) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse createBank(String name, OfflinePlayer player) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse deleteBank(String name) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse bankBalance(String name) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse bankHas(String name, double amount) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse bankWithdraw(String name, double amount) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse bankDeposit(String name, double amount) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse isBankOwner(String name, String playerName) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse isBankOwner(String name, OfflinePlayer player) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse isBankMember(String name, String playerName) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public EconomyResponse isBankMember(String name, OfflinePlayer player) { return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "no banks"); }
            @Override public List<String> getBanks() { return Collections.emptyList(); }
            @Override public boolean createPlayerAccount(String name) { return true; }
            @Override public boolean createPlayerAccount(OfflinePlayer p) { return true; }
            @Override public boolean createPlayerAccount(String name, String world) { return true; }
            @Override public boolean createPlayerAccount(OfflinePlayer p, String world) { return true; }
        }, this, ServicePriority.Normal);
        getLogger().info("TestEconomy registered with Vault (default balance 1,000,000)");
    }
}
JAVA
  cat > "$TE_DIR/src/main/resources/plugin.yml" <<'YML'
name: TestEconomy
main: dev.daniel730.testeconomy.TestEconomy
version: 1.0.0
api-version: '1.21'
depend: [Vault]
YML
  cat > "$TE_DIR/pom.xml" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>dev.daniel730</groupId>
  <artifactId>test-economy</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <repositories>
    <repository><id>papermc</id><url>https://repo.papermc.io/repository/maven-public/</url></repository>
    <repository><id>herocraft</id><url>https://nexus.hc.to/content/repositories/pub_releases/</url></repository>
  </repositories>
  <dependencies>
    <dependency><groupId>io.papermc.paper</groupId><artifactId>paper-api</artifactId><version>26.1.2.build.72-stable</version><scope>provided</scope></dependency>
    <dependency><groupId>net.milkbowl.vault</groupId><artifactId>VaultAPI</artifactId><version>1.7</version><scope>provided</scope></dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-shade-plugin</artifactId><version>3.6.2</version>
        <executions><execution><phase>package</phase><goals><goal>shade</goal></goals></execution></executions>
      </plugin>
    </plugins>
  </build>
</project>
POM
  (cd "$TE_DIR" && mvn -q -B -DskipTests package)
  cp "$TE_DIR/target/test-economy-1.0.0.jar" "$SERVER/plugins/TestEconomy.jar"
fi

echo "== deploy plugin JARs =="
cp -f "$CIVS_JAR" "$SERVER/plugins/civs-1.11.7.jar"
cp -f "$RPG_JAR" "$SERVER/plugins/rpg-server-0.1.2.jar"

echo "== Civs_servidor config pack =="
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude "towns/" \
    --exclude "regions/" \
    --exclude "players/" \
    --exclude "alliances/" \
    --exclude "block-data.yml" \
    "$CIVS_CFG/" "$SERVER/plugins/Civs/"
else
  rm -rf "$SERVER/plugins/Civs"
  mkdir -p "$SERVER/plugins/Civs"
  cp -a "$CIVS_CFG/." "$SERVER/plugins/Civs/"
  rm -rf "$SERVER/plugins/Civs/towns" "$SERVER/plugins/Civs/regions" \
         "$SERVER/plugins/Civs/players" "$SERVER/plugins/Civs/alliances" \
         "$SERVER/plugins/Civs/block-data.yml" 2>/dev/null || true
fi

echo "== server.properties + eula =="
cat > "$SERVER/eula.txt" <<'EULA'
eula=true
EULA
cat > "$SERVER/server.properties" <<'PROPS'
motd=Civs QA Test Server
online-mode=false
enable-command-block=true
spawn-protection=0
max-players=10
view-distance=10
simulation-distance=8
level-name=world
gamemode=creative
force-gamemode=false
difficulty=normal
pvp=true
spawn-npcs=true
spawn-animals=true
spawn-monsters=true
generate-structures=true
white-list=false
PROPS

echo "== QA guide coords near spawn =="
GUIDES="$SERVER/plugins/Civs/npc/guides.yml"
if [[ -f "$GUIDES" ]]; then
  cp "$GUIDES" "$GUIDES.bak-$TS"
  sed -i 's/x: [0-9.-]\+/x: 5/g; s/z: [0-9.-]\+/z: 5/g; s/y: [0-9.-]\+/y: 64/g' "$GUIDES" || true
fi

echo "SETUP_OK server=$SERVER"
ls -la "$SERVER/plugins/"*.jar

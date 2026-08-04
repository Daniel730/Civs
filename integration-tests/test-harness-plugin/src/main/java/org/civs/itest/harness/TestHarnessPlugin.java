package org.civs.itest.harness;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.java.JavaPlugin;

import net.milkbowl.vault.economy.Economy;

import java.util.HashMap;

import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;

/**
 * Server-side integration-test harness for Civs. Exposes machine-parseable inspection and
 * assertion commands so an external runner (over RCON) can verify the plugin's <b>internal
 * state</b> — regions, economy, permissions, blocks, inventories — not just what a bot can
 * see in the world. Every command replies with exactly one line:
 * <ul>
 *   <li>{@code TEST-OK &lt;msg&gt;}   — assertion passed</li>
 *   <li>{@code TEST-FAIL &lt;msg&gt;} — assertion failed</li>
 *   <li>{@code TEST-RESULT k=v ...}   — a query result</li>
 *   <li>{@code TEST-ERROR &lt;msg&gt;}— bad usage / server error</li>
 * </ul>
 */
public class TestHarnessPlugin extends JavaPlugin implements CommandExecutor {

    private Economy economy;

    @Override
    public void onEnable() {
        RegisteredServiceProvider<Economy> rsp = getServer().getServicesManager().getRegistration(Economy.class);
        if (rsp != null) {
            economy = rsp.getProvider();
        }
        getCommand("test").setExecutor(this);
        getLogger().info("CivsTestHarness enabled (economy=" + (economy != null) + ", civs="
                + (getServer().getPluginManager().getPlugin("Civs") != null) + ")");
    }

    // ---- reply helpers ------------------------------------------------------------
    private boolean ok(CommandSender s, String msg) { s.sendMessage("TEST-OK " + msg); return true; }
    private boolean fail(CommandSender s, String msg) { s.sendMessage("TEST-FAIL " + msg); return true; }
    private boolean result(CommandSender s, String kv) { s.sendMessage("TEST-RESULT " + kv); return true; }
    private boolean err(CommandSender s, String msg) { s.sendMessage("TEST-ERROR " + msg); return true; }

    private World world(String[] args, int idx) {
        if (args.length > idx) {
            World w = Bukkit.getWorld(args[idx]);
            if (w != null) return w;
        }
        return Bukkit.getWorlds().get(0);
    }

    @SuppressWarnings("deprecation")
    private OfflinePlayer resolvePlayer(String name) {
        Player online = Bukkit.getPlayerExact(name);
        if (online != null) return online;
        OfflinePlayer cached = Bukkit.getOfflinePlayerIfCached(name);
        if (cached != null) return cached;
        // Offline-mode server: name -> deterministic offline UUID (synchronous, no web lookup).
        return Bukkit.getOfflinePlayer(name);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] a) {
        try {
            if (a.length == 0) return err(sender, "usage: /test <ping|money|assert|region|held|inventory|permission|block|spawnentity|scheduler>");
            String sub = a[0].toLowerCase(Locale.ROOT);
            switch (sub) {
                case "ping":       return ping(sender);
                case "money":      return money(sender, a);
                case "region":     return region(sender, a);
                case "held":       return held(sender, a);
                case "inventory":  return inventory(sender, a);
                case "permission": return permission(sender, a);
                case "block":      return block(sender, a);
                case "setblock":   return setblock(sender, a);
                case "spawnentity":return spawnEntity(sender, a);
                case "scheduler":  return scheduler(sender);
                case "createregion": return createRegion(sender, a);
                case "removeregion": return removeRegion(sender, a);
                case "saveregions":  return saveRegions(sender);
                case "reloadregions":return reloadRegions(sender);
                case "assert":     return assertion(sender, a);
                default:           return err(sender, "unknown subcommand: " + sub);
            }
        } catch (Exception e) {
            return err(sender, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private boolean ping(CommandSender s) {
        boolean civs = getServer().getPluginManager().getPlugin("Civs") != null;
        return result(s, "pong=1 civs=" + civs + " economy=" + (economy != null));
    }

    // /test money get|set|add <player> [amount]
    private boolean money(CommandSender s, String[] a) {
        if (economy == null) return err(s, "no economy provider registered");
        if (a.length < 3) return err(s, "usage: /test money <get|set|add> <player> [amount]");
        String opr = a[1].toLowerCase(Locale.ROOT);
        OfflinePlayer p = resolvePlayer(a[2]);
        if (p == null) return err(s, "unknown player: " + a[2]);
        switch (opr) {
            case "get":
                return result(s, "player=" + a[2] + " balance=" + economy.getBalance(p));
            case "set": {
                double target = Double.parseDouble(a[3]);
                economy.withdrawPlayer(p, economy.getBalance(p));
                economy.depositPlayer(p, target);
                return ok(s, "money set " + a[2] + " -> " + economy.getBalance(p));
            }
            case "add": {
                economy.depositPlayer(p, Double.parseDouble(a[3]));
                return ok(s, "money add " + a[2] + " -> " + economy.getBalance(p));
            }
            default: return err(s, "money op must be get|set|add");
        }
    }

    // /test region at <x> <y> <z> [world]  |  /test region count <type>
    private boolean region(CommandSender s, String[] a) {
        if (a.length >= 2 && a[1].equalsIgnoreCase("count")) {
            if (a.length < 3) return err(s, "usage: /test region count <type>");
            String type = a[2].toLowerCase(Locale.ROOT);
            int count = 0;
            for (Region r : RegionManager.getInstance().getAllRegions()) {
                if (r.getType().equalsIgnoreCase(type)) count++;
            }
            return result(s, "type=" + type + " count=" + count);
        }
        if (a.length >= 5 && a[1].equalsIgnoreCase("at")) {
            Location loc = new Location(world(a, 5), Double.parseDouble(a[2]), Double.parseDouble(a[3]), Double.parseDouble(a[4]));
            Region r = RegionManager.getInstance().getRegionAt(loc);
            if (r == null) return result(s, "region=none");
            return result(s, "type=" + r.getType() + " owners=" + r.getOwners().size()
                    + " forsale=" + r.getForSale() + " exp=" + r.getExp() + " effects=" + r.getEffects().size());
        }
        return err(s, "usage: /test region at <x> <y> <z> [world] | /test region count <type>");
    }

    private boolean held(CommandSender s, String[] a) {
        if (a.length < 2) return err(s, "usage: /test held <player>");
        Player p = Bukkit.getPlayerExact(a[1]);
        if (p == null) return err(s, "player not online: " + a[1]);
        ItemStack item = p.getInventory().getItemInMainHand();
        return result(s, "player=" + a[1] + " held=" + item.getType().name() + " amount=" + item.getAmount());
    }

    private boolean inventory(CommandSender s, String[] a) {
        if (a.length < 2) return err(s, "usage: /test inventory <player>");
        Player p = Bukkit.getPlayerExact(a[1]);
        if (p == null) return err(s, "player not online: " + a[1]);
        StringBuilder sb = new StringBuilder();
        for (ItemStack item : p.getInventory().getContents()) {
            if (item == null || item.getType() == Material.AIR) continue;
            if (sb.length() > 0) sb.append(",");
            sb.append(item.getType().name()).append(":").append(item.getAmount());
        }
        return result(s, "player=" + a[1] + " items=" + (sb.length() == 0 ? "empty" : sb));
    }

    private boolean permission(CommandSender s, String[] a) {
        if (a.length < 3) return err(s, "usage: /test permission <player> <node>");
        Player p = Bukkit.getPlayerExact(a[1]);
        if (p == null) return err(s, "player not online: " + a[1]);
        return result(s, "player=" + a[1] + " node=" + a[2] + " permission=" + p.hasPermission(a[2]));
    }

    /**
     * Runs a world-touching callable on the main thread and blocks (briefly) for the result.
     * RCON dispatches commands off the main thread, so any block/entity access must hop onto it.
     */
    private String sync(java.util.concurrent.Callable<String> callable) throws Exception {
        // RCON commands already run on the primary (server) thread, so calling
        // callSyncMethod().get() here would deadlock. Only hop threads if we're off it.
        if (Bukkit.isPrimaryThread()) {
            return callable.call();
        }
        return Bukkit.getScheduler().callSyncMethod(this, callable).get(10, java.util.concurrent.TimeUnit.SECONDS);
    }

    private static Block blockAt(World w, String[] a, int x, int y, int z) {
        w.getChunkAt(x >> 4, z >> 4).load(true); // ensure the chunk is loaded before reading/writing
        return w.getBlockAt(x, y, z);
    }

    private boolean block(CommandSender s, String[] a) throws Exception {
        if (a.length < 4) return err(s, "usage: /test block <x> <y> <z> [world]");
        World w = world(a, 4);
        int x = (int) Double.parseDouble(a[1]), y = (int) Double.parseDouble(a[2]), z = (int) Double.parseDouble(a[3]);
        return result(s, "material=" + sync(() -> blockAt(w, a, x, y, z).getType().name()));
    }

    // /test setblock <x> <y> <z> <MATERIAL> [world] — reliable main-thread block placement.
    private boolean setblock(CommandSender s, String[] a) throws Exception {
        if (a.length < 5) return err(s, "usage: /test setblock <x> <y> <z> <MATERIAL> [world]");
        World w = world(a, 5);
        int x = (int) Double.parseDouble(a[1]), y = (int) Double.parseDouble(a[2]), z = (int) Double.parseDouble(a[3]);
        Material mat = Material.valueOf(a[4].toUpperCase(Locale.ROOT));
        return result(s, "material=" + sync(() -> { Block b = blockAt(w, a, x, y, z); b.setType(mat); return b.getType().name(); }));
    }

    private boolean spawnEntity(CommandSender s, String[] a) throws Exception {
        if (a.length < 5) return err(s, "usage: /test spawnentity <TYPE> <x> <y> <z> [world]");
        EntityType type = EntityType.valueOf(a[1].toUpperCase(Locale.ROOT));
        World w = world(a, 5);
        Location loc = new Location(w, Double.parseDouble(a[2]), Double.parseDouble(a[3]), Double.parseDouble(a[4]));
        String uuid = sync(() -> {
            w.getChunkAt(loc).load(true);
            Entity e = w.spawnEntity(loc, type);
            return e.getUniqueId().toString();
        });
        return result(s, "spawned=" + type + " uuid=" + uuid);
    }

    // A fixed synthetic owner so server-side region creation needs no online player.
    private static final UUID SYNTHETIC_OWNER = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

    // /test createregion <type> <x> <y> <z> [world] — create + persist a region via the Civs API.
    private boolean createRegion(CommandSender s, String[] a) {
        if (a.length < 5) return err(s, "usage: /test createregion <type> <x> <y> <z> [world]");
        String type = a[1].toLowerCase(Locale.ROOT);
        var civItem = ItemManager.getInstance().getItemType(type);
        if (!(civItem instanceof RegionType regionType)) return err(s, "not a region type: " + type);
        Location loc = new Location(world(a, 5), Double.parseDouble(a[2]), Double.parseDouble(a[3]), Double.parseDouble(a[4]));
        HashMap<UUID, String> people = new HashMap<>();
        people.put(SYNTHETIC_OWNER, "owner");
        @SuppressWarnings("unchecked")
        HashMap<String, String> effects = (HashMap<String, String>) regionType.getEffects().clone();
        Region region = new Region(regionType.getProcessedName(), people, loc,
                new int[] { 3, 3, 3, 3, 3, 3 }, effects, 0);
        RegionManager.getInstance().addRegion(region);
        RegionManager.getInstance().saveRegion(region);
        return result(s, "created=" + region.getType() + " id=" + region.getId());
    }

    // /test removeregion <x> <y> <z> [world]
    private boolean removeRegion(CommandSender s, String[] a) {
        if (a.length < 4) return err(s, "usage: /test removeregion <x> <y> <z> [world]");
        Location loc = new Location(world(a, 4), Double.parseDouble(a[1]), Double.parseDouble(a[2]), Double.parseDouble(a[3]));
        Region r = RegionManager.getInstance().getRegionAt(loc);
        if (r == null) return result(s, "removed=0");
        RegionManager.getInstance().removeRegion(r, false, false);
        return result(s, "removed=1 type=" + r.getType());
    }

    private boolean saveRegions(CommandSender s) {
        RegionManager.getInstance().saveAllUnsavedRegions();
        return ok(s, "regions saved");
    }

    // Reloads regions from disk — used to prove persistence survives a reload.
    private boolean reloadRegions(CommandSender s) {
        RegionManager.getInstance().reload();
        return result(s, "reloaded regions=" + RegionManager.getInstance().getAllRegions().size());
    }

    private boolean scheduler(CommandSender s) {
        int civsTasks = 0;
        var civs = getServer().getPluginManager().getPlugin("Civs");
        for (var task : Bukkit.getScheduler().getPendingTasks()) {
            if (civs != null && task.getOwner() == civs) civsTasks++;
        }
        return result(s, "civsPendingTasks=" + civsTasks);
    }

    // ---- assertions ---------------------------------------------------------------
    // /test assert <economy|region|permission|block|inventory|town> ...
    private boolean assertion(CommandSender s, String[] a) throws Exception {
        if (a.length < 2) return err(s, "usage: /test assert <economy|region|permission|block|inventory|town> ...");
        String what = a[1].toLowerCase(Locale.ROOT);
        switch (what) {
            case "economy": { // assert economy <player> <eq|ge|le> <amount>
                if (economy == null) return err(s, "no economy provider");
                if (a.length < 5) return err(s, "usage: /test assert economy <player> <eq|ge|le> <amount>");
                OfflinePlayer p = resolvePlayer(a[2]);
                if (p == null) return err(s, "unknown player: " + a[2]);
                double bal = economy.getBalance(p);
                double amt = Double.parseDouble(a[4]);
                boolean pass = switch (a[3].toLowerCase(Locale.ROOT)) {
                    case "eq" -> Math.abs(bal - amt) < 0.001;
                    case "ge" -> bal >= amt;
                    case "le" -> bal <= amt;
                    default -> false;
                };
                return pass ? ok(s, "economy " + a[2] + " " + a[3] + " " + amt + " (actual " + bal + ")")
                            : fail(s, "economy " + a[2] + " expected " + a[3] + " " + amt + " but was " + bal);
            }
            case "region": { // assert region <type> <x> <y> <z> [world]
                if (a.length < 6) return err(s, "usage: /test assert region <type> <x> <y> <z> [world]");
                Location loc = new Location(world(a, 6), Double.parseDouble(a[3]), Double.parseDouble(a[4]), Double.parseDouble(a[5]));
                Region r = RegionManager.getInstance().getRegionAt(loc);
                if (r == null) return fail(s, "no region at " + a[3] + "," + a[4] + "," + a[5]);
                return r.getType().equalsIgnoreCase(a[2])
                        ? ok(s, "region " + a[2] + " present at " + a[3] + "," + a[4] + "," + a[5])
                        : fail(s, "region at loc is " + r.getType() + ", expected " + a[2]);
            }
            case "permission": { // assert permission <player> <node> <true|false>
                if (a.length < 5) return err(s, "usage: /test assert permission <player> <node> <true|false>");
                Player p = Bukkit.getPlayerExact(a[2]);
                if (p == null) return err(s, "player not online: " + a[2]);
                boolean actual = p.hasPermission(a[3]);
                boolean expected = Boolean.parseBoolean(a[4]);
                return actual == expected ? ok(s, "permission " + a[3] + "=" + actual)
                        : fail(s, "permission " + a[3] + " expected " + expected + " but was " + actual);
            }
            case "block": { // assert block <x> <y> <z> <MATERIAL> [world]
                if (a.length < 6) return err(s, "usage: /test assert block <x> <y> <z> <MATERIAL> [world]");
                World w = world(a, 6);
                int x = (int) Double.parseDouble(a[2]), y = (int) Double.parseDouble(a[3]), z = (int) Double.parseDouble(a[4]);
                String actual = sync(() -> blockAt(w, a, x, y, z).getType().name());
                return actual.equalsIgnoreCase(a[5]) ? ok(s, "block=" + actual)
                        : fail(s, "block expected " + a[5] + " but was " + actual);
            }
            case "inventory": { // assert inventory <player> <MATERIAL> [minCount]
                if (a.length < 4) return err(s, "usage: /test assert inventory <player> <MATERIAL> [minCount]");
                Player p = Bukkit.getPlayerExact(a[2]);
                if (p == null) return err(s, "player not online: " + a[2]);
                Material mat = Material.valueOf(a[3].toUpperCase(Locale.ROOT));
                int minCount = a.length > 4 ? Integer.parseInt(a[4]) : 1;
                int total = 0;
                for (ItemStack item : p.getInventory().getContents()) {
                    if (item != null && item.getType() == mat) total += item.getAmount();
                }
                return total >= minCount ? ok(s, "inventory has " + total + "x " + mat)
                        : fail(s, "inventory has " + total + "x " + mat + ", expected >= " + minCount);
            }
            case "town": { // assert town <name> exists
                if (a.length < 4 || !a[3].equalsIgnoreCase("exists")) return err(s, "usage: /test assert town <name> exists");
                Town t = TownManager.getInstance().getTown(a[2]);
                return t != null ? ok(s, "town " + a[2] + " exists") : fail(s, "town " + a[2] + " does not exist");
            }
            default: return err(s, "unknown assert type: " + what);
        }
    }
}

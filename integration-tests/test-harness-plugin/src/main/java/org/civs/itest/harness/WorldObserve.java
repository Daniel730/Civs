package org.civs.itest.harness;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;

/**
 * Hierarchical world observation for AI agents — local slice only, never full world dump.
 * <pre>
 * /test world nearby &lt;player&gt; [radius]
 * </pre>
 */
final class WorldObserve {

    private WorldObserve() {}

    static boolean handle(CommandSender sender, String[] a) {
        if (a.length < 2) {
            return err(sender, "usage: /test world <nearby> ...");
        }
        String sub = a[1].toLowerCase(Locale.ROOT);
        if ("nearby".equals(sub)) {
            if (a.length < 3) return err(sender, "usage: /test world nearby <player> [radius]");
            double radius = a.length >= 4 ? Double.parseDouble(a[3]) : 48.0;
            return nearby(sender, a[2], radius);
        }
        return err(sender, "unknown world subcommand: " + sub);
    }

    private static boolean nearby(CommandSender sender, String playerName, double radius) {
        long t0 = System.currentTimeMillis();
        if (radius < 1) radius = 1;
        if (radius > 128) radius = 128;
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return fail(sender, "world_nearby", playerName, t0, "player_offline");
        }
        Location origin = player.getLocation();
        World world = origin.getWorld();
        if (world == null) {
            return fail(sender, "world_nearby", playerName, t0, "no_world");
        }

        String biome = "UNKNOWN";
        try {
            biome = world.getBiome(origin.getBlockX(), origin.getBlockY(), origin.getBlockZ()).toString();
        } catch (Exception ignored) {
            // Paper biome API shape may vary — leave UNKNOWN
        }

        List<String> players = new ArrayList<>();
        List<String> entities = new ArrayList<>();
        for (Entity e : player.getNearbyEntities(radius, radius, radius)) {
            if (e instanceof Player other && !other.equals(player)) {
                players.add("{\"name\":" + q(other.getName())
                        + ",\"x\":" + round(other.getLocation().getX())
                        + ",\"y\":" + round(other.getLocation().getY())
                        + ",\"z\":" + round(other.getLocation().getZ()) + "}");
            } else if (!(e instanceof Player) && entities.size() < 24) {
                entities.add("{\"type\":" + q(e.getType().name())
                        + ",\"x\":" + round(e.getLocation().getX())
                        + ",\"y\":" + round(e.getLocation().getY())
                        + ",\"z\":" + round(e.getLocation().getZ()) + "}");
            }
        }

        List<String> regions = new ArrayList<>();
        Plugin civs = Bukkit.getPluginManager().getPlugin("Civs");
        if (civs != null && civs.isEnabled()) {
            double r2 = radius * radius;
            for (Region region : RegionManager.getInstance().getAllRegions()) {
                Location loc = region.getLocation();
                if (loc == null || loc.getWorld() == null) continue;
                if (!loc.getWorld().equals(world)) continue;
                if (loc.distanceSquared(origin) > r2) continue;
                regions.add("{\"type\":" + q(region.getType())
                        + ",\"id\":" + q(region.getId())
                        + ",\"x\":" + round(loc.getX())
                        + ",\"y\":" + round(loc.getY())
                        + ",\"z\":" + round(loc.getZ()) + "}");
                if (regions.size() >= 32) break;
            }
        }

        String townName = null;
        if (civs != null && civs.isEnabled()) {
            Town town = TownManager.getInstance().getTownAt(origin);
            if (town != null) townName = town.getName();
        }

        String data = "\"world\":" + q(world.getName())
                + ",\"x\":" + round(origin.getX())
                + ",\"y\":" + round(origin.getY())
                + ",\"z\":" + round(origin.getZ())
                + ",\"radius\":" + radius
                + ",\"biome\":" + q(biome)
                + ",\"time\":" + world.getTime()
                + ",\"storm\":" + world.hasStorm()
                + ",\"town\":" + (townName == null ? "null" : q(townName))
                + ",\"players\":[" + String.join(",", players) + "]"
                + ",\"entities\":[" + String.join(",", entities) + "]"
                + ",\"regions\":[" + String.join(",", regions) + "]"
                + ",\"civs_present\":" + (civs != null && civs.isEnabled());
        sender.sendMessage("TEST-RESULT json={\"success\":true,\"action\":\"world_nearby\",\"target\":"
                + q(playerName) + ",\"duration_ms\":" + (System.currentTimeMillis() - t0)
                + ",\"reason\":null,\"data\":{" + data + "}}");
        return true;
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static String q(String s) {
        if (s == null) return "null";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static boolean fail(CommandSender sender, String action, String target, long t0, String reason) {
        sender.sendMessage("TEST-RESULT json={\"success\":false,\"action\":" + q(action)
                + ",\"target\":" + q(target)
                + ",\"duration_ms\":" + (System.currentTimeMillis() - t0)
                + ",\"reason\":" + q(reason) + ",\"data\":{}}");
        return true;
    }

    private static boolean err(CommandSender sender, String msg) {
        sender.sendMessage("TEST-ERROR " + msg);
        return true;
    }
}

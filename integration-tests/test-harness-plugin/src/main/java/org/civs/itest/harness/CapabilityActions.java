package org.civs.itest.harness;

import java.util.Locale;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;

/**
 * Server-side player capability execution for Paper 26.1.2 (where Mineflayer cannot drive
 * the client). Invokes verified Bukkit/Paper {@link Player} APIs against an online player
 * held by the protocol actor. Returns one {@code TEST-RESULT json=...} line.
 *
 * <p>This is an <b>actor</b> concern (production event paths), not Civs game-state creation.
 */
final class CapabilityActions {

    private CapabilityActions() {}

    static boolean handle(CommandSender sender, String[] a, TestHarnessPlugin plugin) throws Exception {
        if (a.length < 2) {
            return err(sender, "usage: /test act <player> <action> ... | /test observe <player>");
        }
        String sub = a[0].toLowerCase(Locale.ROOT);
        if (sub.equals("observe")) {
            return observe(sender, a[1], plugin);
        }
        if (!sub.equals("act")) {
            return err(sender, "unknown capability verb: " + sub);
        }
        if (a.length < 3) {
            return err(sender, "usage: /test act <player> <action> [args...]");
        }
        String playerName = a[1];
        String action = a[2].toLowerCase(Locale.ROOT);
        String[] args = new String[a.length - 3];
        System.arraycopy(a, 3, args, 0, args.length);
        return plugin.syncCap(() -> execute(sender, playerName, action, args));
    }

    private static boolean execute(CommandSender sender, String playerName, String action, String[] args) {
        long t0 = System.currentTimeMillis();
        Player p = Bukkit.getPlayerExact(playerName);
        if (p == null || !p.isOnline()) {
            return json(sender, false, action, null, System.currentTimeMillis() - t0, "player_offline", null);
        }
        try {
            return switch (action) {
                case "teleport" -> teleport(sender, p, args, t0);
                case "look" -> look(sender, p, args, t0);
                case "look_at" -> lookAt(sender, p, args, t0);
                case "sneak" -> flag(sender, p, args, t0, "sneak", true);
                case "sprint" -> flag(sender, p, args, t0, "sprint", false);
                case "jump" -> jump(sender, p, t0);
                case "swing" -> { p.swingMainHand(); yield ok(sender, "swing", null, t0, "\"hand\":\"main\""); }
                case "break_block" -> breakBlock(sender, p, args, t0);
                case "place_block" -> placeBlock(sender, p, args, t0);
                case "attack" -> attack(sender, p, args, t0);
                case "hotbar" -> hotbar(sender, p, args, t0);
                case "give_item" -> giveItem(sender, p, args, t0);
                case "run_as" -> runAs(sender, p, args, t0);
                case "game_mode" -> gameMode(sender, p, args, t0);
                case "die" -> die(sender, p, t0);
                case "respawn" -> respawn(sender, p, t0);
                default -> json(sender, false, action, null, System.currentTimeMillis() - t0,
                        "unknown_action", null);
            };
        } catch (IllegalArgumentException ex) {
            return json(sender, false, action, null, System.currentTimeMillis() - t0,
                    "bad_args:" + ex.getMessage(), null);
        } catch (Exception ex) {
            return json(sender, false, action, null, System.currentTimeMillis() - t0,
                    ex.getClass().getSimpleName() + ":" + ex.getMessage(), null);
        }
    }

    private static boolean observe(CommandSender sender, String playerName, TestHarnessPlugin plugin) throws Exception {
        return plugin.syncCap(() -> {
            Player p = Bukkit.getPlayerExact(playerName);
            if (p == null || !p.isOnline()) {
                return json(sender, false, "observe", null, 0, "player_offline", null);
            }
            Location loc = p.getLocation();
            StringBuilder items = new StringBuilder("[");
            int n = 0;
            for (ItemStack item : p.getInventory().getContents()) {
                if (item == null || item.getType() == Material.AIR) continue;
                if (n++ > 0) items.append(',');
                items.append("{\"material\":").append(quote(item.getType().name()))
                        .append(",\"amount\":").append(item.getAmount()).append('}');
                if (n >= 40) break;
            }
            items.append(']');
            String data = "\"world\":" + quote(loc.getWorld() != null ? loc.getWorld().getName() : "")
                    + ",\"x\":" + loc.getX()
                    + ",\"y\":" + loc.getY()
                    + ",\"z\":" + loc.getZ()
                    + ",\"yaw\":" + loc.getYaw()
                    + ",\"pitch\":" + loc.getPitch()
                    + ",\"health\":" + p.getHealth()
                    + ",\"max_health\":" + maxHealth(p)
                    + ",\"food\":" + p.getFoodLevel()
                    + ",\"saturation\":" + p.getSaturation()
                    + ",\"game_mode\":" + quote(p.getGameMode().name())
                    + ",\"sneaking\":" + p.isSneaking()
                    + ",\"sprinting\":" + p.isSprinting()
                    + ",\"held\":" + quote(p.getInventory().getItemInMainHand().getType().name())
                    + ",\"held_amount\":" + p.getInventory().getItemInMainHand().getAmount()
                    + ",\"hotbar_slot\":" + p.getInventory().getHeldItemSlot()
                    + ",\"inventory\":" + items;
            return json(sender, true, "observe", playerName, 0, null, data);
        });
    }

    private static boolean teleport(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 3) throw new IllegalArgumentException("teleport <x> <y> <z> [yaw] [pitch]");
        Location loc = p.getLocation().clone();
        loc.setX(Double.parseDouble(args[0]));
        loc.setY(Double.parseDouble(args[1]));
        loc.setZ(Double.parseDouble(args[2]));
        if (args.length >= 5) {
            loc.setYaw(Float.parseFloat(args[3]));
            loc.setPitch(Float.parseFloat(args[4]));
        }
        loc.getChunk().load(true);
        boolean ok = p.teleport(loc);
        return json(sender, ok, "teleport", fmt(loc), System.currentTimeMillis() - t0,
                ok ? null : "teleport_failed", null);
    }

    private static boolean look(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 2) throw new IllegalArgumentException("look <yaw> <pitch>");
        float yaw = Float.parseFloat(args[0]);
        float pitch = Float.parseFloat(args[1]);
        p.setRotation(yaw, pitch);
        return ok(sender, "look", null, t0, "\"yaw\":" + yaw + ",\"pitch\":" + pitch);
    }

    private static boolean lookAt(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 3) throw new IllegalArgumentException("look_at <x> <y> <z>");
        Location eye = p.getEyeLocation();
        double x = Double.parseDouble(args[0]) + 0.5;
        double y = Double.parseDouble(args[1]) + 0.5;
        double z = Double.parseDouble(args[2]) + 0.5;
        Vector dir = new Vector(x - eye.getX(), y - eye.getY(), z - eye.getZ()).normalize();
        Location tmp = eye.clone();
        tmp.setDirection(dir);
        p.setRotation(tmp.getYaw(), tmp.getPitch());
        return ok(sender, "look_at", args[0] + "," + args[1] + "," + args[2], t0,
                "\"yaw\":" + tmp.getYaw() + ",\"pitch\":" + tmp.getPitch());
    }

    private static boolean flag(CommandSender sender, Player p, String[] args, long t0, String action, boolean sneak) {
        if (args.length < 1) throw new IllegalArgumentException(action + " <on|off|true|false>");
        boolean on = parseBool(args[0]);
        if (sneak) p.setSneaking(on); else p.setSprinting(on);
        return ok(sender, action, String.valueOf(on), t0, "\"value\":" + on);
    }

    private static boolean jump(CommandSender sender, Player p, long t0) {
        // Paper exposes setJumping(boolean); upward velocity is the reliable physical impulse.
        p.setJumping(true);
        Vector v = p.getVelocity().clone();
        if (v.getY() < 0.42) v.setY(0.42);
        p.setVelocity(v);
        return ok(sender, "jump", null, t0, "\"vy\":" + v.getY());
    }

    private static boolean breakBlock(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 3) throw new IllegalArgumentException("break_block <x> <y> <z> [world]");
        World w = world(args, 3, p.getWorld());
        int x = (int) Double.parseDouble(args[0]);
        int y = (int) Double.parseDouble(args[1]);
        int z = (int) Double.parseDouble(args[2]);
        w.getChunkAt(x >> 4, z >> 4).load(true);
        Block b = w.getBlockAt(x, y, z);
        Material before = b.getType();
        if (before == Material.AIR || before == Material.CAVE_AIR || before == Material.VOID_AIR) {
            return json(sender, false, "break_block", fmt(b.getLocation()), System.currentTimeMillis() - t0,
                    "already_air", "\"before\":" + quote(before.name()));
        }
        boolean broke = p.breakBlock(b);
        Material after = b.getType();
        return json(sender, broke, "break_block", fmt(b.getLocation()), System.currentTimeMillis() - t0,
                broke ? null : "break_failed_or_cancelled",
                "\"before\":" + quote(before.name()) + ",\"after\":" + quote(after.name()));
    }

    private static boolean placeBlock(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 4) throw new IllegalArgumentException("place_block <x> <y> <z> <MATERIAL> [world]");
        World w = world(args, 4, p.getWorld());
        int x = (int) Double.parseDouble(args[0]);
        int y = (int) Double.parseDouble(args[1]);
        int z = (int) Double.parseDouble(args[2]);
        Material mat = Material.valueOf(args[3].toUpperCase(Locale.ROOT));
        if (!mat.isBlock()) {
            return json(sender, false, "place_block", null, System.currentTimeMillis() - t0,
                    "not_a_block", "\"material\":" + quote(mat.name()));
        }
        w.getChunkAt(x >> 4, z >> 4).load(true);
        Block placed = w.getBlockAt(x, y, z);
        Block against = placed.getRelative(BlockFace.DOWN);
        BlockState replaced = placed.getState();
        ItemStack hand = new ItemStack(mat, 1);
        p.getInventory().setItemInMainHand(hand);
        BlockPlaceEvent event = new BlockPlaceEvent(
                placed, replaced, against, hand, p, true, EquipmentSlot.HAND);
        Bukkit.getPluginManager().callEvent(event);
        if (event.isCancelled() || !event.canBuild()) {
            return json(sender, false, "place_block", fmt(placed.getLocation()), System.currentTimeMillis() - t0,
                    "cancelled", "\"material\":" + quote(mat.name()));
        }
        placed.setType(mat);
        return json(sender, true, "place_block", fmt(placed.getLocation()), System.currentTimeMillis() - t0,
                null, "\"material\":" + quote(placed.getType().name()) + ",\"via\":\"BlockPlaceEvent\"");
    }

    private static boolean attack(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("attack <uuid|nearest> [ENTITY_TYPE]");
        Entity target;
        if (args[0].equalsIgnoreCase("nearest")) {
            EntityType type = args.length >= 2 ? EntityType.valueOf(args[1].toUpperCase(Locale.ROOT)) : null;
            target = nearest(p, type);
            if (target == null) {
                return json(sender, false, "attack", null, System.currentTimeMillis() - t0, "no_target", null);
            }
        } else {
            UUID id = UUID.fromString(args[0]);
            target = Bukkit.getEntity(id);
            if (target == null) {
                return json(sender, false, "attack", args[0], System.currentTimeMillis() - t0, "entity_not_found", null);
            }
        }
        p.attack(target);
        p.swingMainHand();
        String data = "\"entity_type\":" + quote(target.getType().name())
                + ",\"uuid\":" + quote(target.getUniqueId().toString());
        if (target instanceof LivingEntity living) {
            data += ",\"target_health\":" + living.getHealth();
        }
        return ok(sender, "attack", target.getUniqueId().toString(), t0, data);
    }

    private static boolean hotbar(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("hotbar <0-8>");
        int slot = Integer.parseInt(args[0]);
        if (slot < 0 || slot > 8) throw new IllegalArgumentException("hotbar slot must be 0-8");
        p.getInventory().setHeldItemSlot(slot);
        return ok(sender, "hotbar", String.valueOf(slot), t0,
                "\"held\":" + quote(p.getInventory().getItemInMainHand().getType().name()));
    }

    private static boolean gameMode(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("game_mode <SURVIVAL|CREATIVE|ADVENTURE|SPECTATOR>");
        GameMode mode = GameMode.valueOf(args[0].toUpperCase(Locale.ROOT));
        p.setGameMode(mode);
        return ok(sender, "game_mode", mode.name(), t0, "\"game_mode\":" + quote(p.getGameMode().name()));
    }

    /** Kill the player via {@link org.bukkit.entity.Damageable#setHealth(double)} (0). Creative mode may prevent death. */
    private static boolean die(CommandSender sender, Player p, long t0) {
        if (p.getGameMode() == GameMode.CREATIVE || p.getGameMode() == GameMode.SPECTATOR) {
            return json(sender, false, "die", p.getName(), System.currentTimeMillis() - t0,
                    "wrong_game_mode", "\"game_mode\":" + quote(p.getGameMode().name()));
        }
        p.setHealth(0.0);
        boolean dead = p.isDead() || p.getHealth() <= 0.0;
        return json(sender, dead, "die", p.getName(), System.currentTimeMillis() - t0,
                dead ? null : "not_dead",
                "\"health\":" + p.getHealth() + ",\"dead\":" + p.isDead());
    }

    /** Respawn via {@link org.bukkit.entity.Player.Spigot#respawn()}. */
    private static boolean respawn(CommandSender sender, Player p, long t0) {
        if (!p.isDead()) {
            return json(sender, false, "respawn", p.getName(), System.currentTimeMillis() - t0,
                    "not_dead", "\"health\":" + p.getHealth());
        }
        p.spigot().respawn();
        boolean alive = !p.isDead() && p.getHealth() > 0.0;
        Location loc = p.getLocation();
        return json(sender, alive, "respawn", fmt(loc), System.currentTimeMillis() - t0,
                alive ? null : "respawn_failed",
                "\"health\":" + p.getHealth() + ",\"dead\":" + p.isDead());
    }

    /** Run a player command via {@link Player#performCommand} (no leading slash). Allowlisted prefixes only. */
    private static boolean runAs(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("run_as <command without slash>");
        String cmd = String.join(" ", args).replaceFirst("^/", "");
        String head = cmd.split("\\s+")[0].toLowerCase(Locale.ROOT);
        if (!(head.equals("rpg") || head.equals("cv") || head.equals("say") || head.equals("me"))) {
            return json(sender, false, "run_as", cmd, System.currentTimeMillis() - t0,
                    "command_not_allowlisted", "\"allowed\":\"rpg|cv|say|me\"");
        }
        boolean ok = p.performCommand(cmd);
        return json(sender, ok, "run_as", cmd, System.currentTimeMillis() - t0,
                ok ? null : "performCommand_returned_false", null);
    }

    private static boolean giveItem(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("give_item <MATERIAL> [amount]");
        Material mat = Material.valueOf(args[0].toUpperCase(Locale.ROOT));
        int amount = args.length >= 2 ? Integer.parseInt(args[1]) : 1;
        ItemStack stack = new ItemStack(mat, amount);
        var leftover = p.getInventory().addItem(stack);
        boolean ok = leftover.isEmpty();
        return json(sender, ok, "give_item", mat.name(), System.currentTimeMillis() - t0,
                ok ? null : "inventory_full",
                "\"amount\":" + amount + ",\"leftover\":" + leftover.values().stream()
                        .mapToInt(ItemStack::getAmount).sum());
    }

    private static double maxHealth(Player p) {
        var attr = p.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH);
        return attr != null ? attr.getValue() : 20.0;
    }

    private static Entity nearest(Player p, EntityType type) {
        Entity best = null;
        double bestDist = Double.MAX_VALUE;
        for (Entity e : p.getNearbyEntities(16, 16, 16)) {
            if (e.equals(p)) continue;
            if (type != null && e.getType() != type) continue;
            double d = e.getLocation().distanceSquared(p.getLocation());
            if (d < bestDist) { bestDist = d; best = e; }
        }
        return best;
    }

    private static World world(String[] args, int idx, World fallback) {
        if (args.length > idx) {
            World w = Bukkit.getWorld(args[idx]);
            if (w != null) return w;
        }
        return fallback;
    }

    private static boolean parseBool(String s) {
        String v = s.toLowerCase(Locale.ROOT);
        if (v.equals("on") || v.equals("true") || v.equals("1")) return true;
        if (v.equals("off") || v.equals("false") || v.equals("0")) return false;
        throw new IllegalArgumentException("expected on|off|true|false");
    }

    private static boolean ok(CommandSender sender, String action, String target, long t0, String data) {
        return json(sender, true, action, target, System.currentTimeMillis() - t0, null, data);
    }

    private static boolean json(CommandSender sender, boolean success, String action, String target,
                                long durationMs, String reason, String dataObj) {
        StringBuilder sb = new StringBuilder(128);
        sb.append("{\"success\":").append(success)
                .append(",\"action\":").append(quote(action))
                .append(",\"target\":").append(target == null ? "null" : quote(target))
                .append(",\"duration_ms\":").append(durationMs)
                .append(",\"reason\":").append(reason == null ? "null" : quote(reason))
                .append(",\"data\":{");
        if (dataObj != null && !dataObj.isEmpty()) sb.append(dataObj);
        sb.append("}}");
        sender.sendMessage("TEST-RESULT json=" + sb);
        return true;
    }

    private static boolean err(CommandSender sender, String msg) {
        sender.sendMessage("TEST-ERROR " + msg);
        return true;
    }

    private static String quote(String v) {
        return '"' + (v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"")) + '"';
    }

    private static String fmt(Location loc) {
        String w = loc.getWorld() != null ? loc.getWorld().getName() : "?";
        return w + ":" + loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ();
    }
}

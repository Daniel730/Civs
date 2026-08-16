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
        return plugin.syncCap(() -> execute(sender, playerName, action, args, plugin));
    }

    private static boolean execute(CommandSender sender, String playerName, String action, String[] args,
                                   TestHarnessPlugin plugin) {
        long t0 = System.currentTimeMillis();
        Player p = Bukkit.getPlayerExact(playerName);
        if (p == null || !p.isOnline()) {
            return json(sender, false, action, null, System.currentTimeMillis() - t0, "player_offline", null);
        }
        try {
            Boolean motion = MotionActions.dispatch(sender, p, action, args, t0, plugin);
            if (motion != null) return motion;
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
                                case "craft_item" -> craftItem(sender, p, args, t0);
                                case "run_as" -> runAs(sender, p, args, t0);
                case "game_mode" -> gameMode(sender, p, args, t0);
                case "die" -> die(sender, p, t0);
                case "respawn" -> respawn(sender, p, t0);
                case "step" -> step(sender, p, args, t0);
                case "move_to" -> moveTo(sender, p, args, t0);
                case "find_block" -> findBlock(sender, p, args, t0);
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
            String data = survivalData(p, loc)
                    + ",\"world\":" + quote(loc.getWorld() != null ? loc.getWorld().getName() : "")
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

    /**
     * Threat / hazard context for the agent survival layer.
     *
     * <p>Everything the SAFE/CAUTION/DANGER FSM needs has to arrive in the same round trip as the
     * position — polling health, hostiles and hazards separately would cost three extra RCON calls
     * per tick and could report a mix of two different world states.
     */
    private static String survivalData(Player p, Location loc) {
        World w = loc.getWorld();
        String blockBelow = "AIR";
        String blockFeet = "AIR";
        int light = 15;
        if (w != null) {
            try {
                Block below = w.getBlockAt(loc.getBlockX(), loc.getBlockY() - 1, loc.getBlockZ());
                Block feet = w.getBlockAt(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ());
                blockBelow = below.getType().name();
                blockFeet = feet.getType().name();
                light = feet.getLightLevel();
            } catch (Exception ignored) {
                // unloaded chunk — keep defaults
            }
        }

        int hostiles = 0;
        String nearestType = null;
        double nearestDist = -1;
        try {
            for (Entity e : p.getNearbyEntities(20, 12, 20)) {
                if (!(e instanceof org.bukkit.entity.Monster)) continue;
                hostiles++;
                double d = e.getLocation().distance(loc);
                if (nearestDist < 0 || d < nearestDist) {
                    nearestDist = d;
                    nearestType = e.getType().name();
                }
            }
        } catch (Exception ignored) {
            // entity list can throw while chunks unload
        }

        String damageCause = null;
        double lastDamage = 0;
        try {
            var ev = p.getLastDamageCause();
            if (ev != null) {
                damageCause = ev.getCause().name();
                lastDamage = ev.getFinalDamage();
            }
        } catch (Exception ignored) {
            // no damage recorded yet
        }

        int deaths = -1;
        try {
            deaths = p.getStatistic(org.bukkit.Statistic.DEATHS);
        } catch (Exception ignored) {
            // statistics may be unavailable for protocol actors
        }

        boolean inWater = blockFeet.equals("WATER") || blockFeet.contains("BUBBLE");
        boolean inLava = blockFeet.equals("LAVA");
        return "\"dead\":" + p.isDead()
                + ",\"on_ground\":" + p.isOnGround()
                + ",\"fall_distance\":" + round2(p.getFallDistance())
                + ",\"remaining_air\":" + p.getRemainingAir()
                + ",\"in_water\":" + inWater
                + ",\"in_lava\":" + inLava
                + ",\"light_level\":" + light
                + ",\"block_below\":" + quote(blockBelow)
                + ",\"block_feet\":" + quote(blockFeet)
                + ",\"hostiles\":" + hostiles
                + ",\"nearest_hostile\":" + (nearestType == null ? "null"
                        : "{\"type\":" + quote(nearestType) + ",\"distance\":" + round2(nearestDist) + "}")
                + ",\"last_damage_cause\":" + (damageCause == null ? "null" : quote(damageCause))
                + ",\"last_damage\":" + round2(lastDamage)
                + ",\"deaths\":" + deaths
                + ",\"world_time\":" + (w != null ? w.getTime() : -1)
                + ",\"storm\":" + (w != null && w.hasStorm());
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
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

    /**
     * Nearest matching block within a cubic radius (capped). Used by AI World mine loops —
     * not a full world scan.
     * Usage: {@code find_block <MATERIAL> [radius=6] [max=5]}
     */
    private static boolean findBlock(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("find_block <MATERIAL> [radius] [max]");
        Material want = Material.valueOf(args[0].toUpperCase(Locale.ROOT));
        int radius = args.length >= 2 ? Integer.parseInt(args[1]) : 6;
        int max = args.length >= 3 ? Integer.parseInt(args[2]) : 5;
        if (radius < 1) radius = 1;
        if (radius > 16) radius = 16;
        if (max < 1) max = 1;
        if (max > 32) max = 32;
        Location origin = p.getLocation();
        World w = origin.getWorld();
        if (w == null) {
            return json(sender, false, "find_block", want.name(), System.currentTimeMillis() - t0, "no_world", null);
        }
        int ox = origin.getBlockX();
        int oy = origin.getBlockY();
        int oz = origin.getBlockZ();
        java.util.List<Block> found = new java.util.ArrayList<>();
        double best = Double.MAX_VALUE;
        Block nearest = null;
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    Block b = w.getBlockAt(ox + dx, oy + dy, oz + dz);
                    if (b.getType() != want) continue;
                    double d = b.getLocation().distanceSquared(origin);
                    if (d < best) {
                        best = d;
                        nearest = b;
                    }
                    if (found.size() < max) {
                        found.add(b);
                    }
                }
            }
        }
        if (nearest == null) {
            return json(sender, false, "find_block", want.name(), System.currentTimeMillis() - t0,
                    "not_found", "\"radius\":" + radius + ",\"count\":0");
        }
        // Sort found by distance for stable output
        found.sort((a, c) -> Double.compare(
                a.getLocation().distanceSquared(origin),
                c.getLocation().distanceSquared(origin)));
        StringBuilder arr = new StringBuilder("[");
        for (int i = 0; i < found.size(); i++) {
            Block b = found.get(i);
            if (i > 0) arr.append(',');
            arr.append("{\"x\":").append(b.getX())
                    .append(",\"y\":").append(b.getY())
                    .append(",\"z\":").append(b.getZ())
                    .append(",\"material\":").append(quote(b.getType().name())).append('}');
        }
        arr.append(']');
        return json(sender, true, "find_block", want.name(), System.currentTimeMillis() - t0, null,
                "\"radius\":" + radius
                        + ",\"count\":" + found.size()
                        + ",\"nearest\":{\"x\":" + nearest.getX()
                        + ",\"y\":" + nearest.getY()
                        + ",\"z\":" + nearest.getZ()
                        + ",\"material\":" + quote(nearest.getType().name()) + "}"
                        + ",\"blocks\":" + arr);
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

    /**
     * Single greedy navigation step toward a point (or forward). Not a pathfinder —
     * uses {@link Player#teleport} after a collision probe. Empirically for open terrain.
     * Usage: {@code step <x> <y> <z> [step_len]} or {@code step forward [step_len]}.
     */
    private static boolean step(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 1) throw new IllegalArgumentException("step <x> <y> <z> [len] | step forward [len]");
        double len = 0.8;
        Location cur = p.getLocation();
        Vector dir;
        String targetLabel;
        if (args[0].equalsIgnoreCase("forward")) {
            if (args.length >= 2) len = Double.parseDouble(args[1]);
            dir = cur.getDirection().clone();
            dir.setY(0);
            if (dir.lengthSquared() < 1e-6) dir = new Vector(0, 0, 1);
            dir.normalize().multiply(len);
            targetLabel = "forward";
        } else {
            if (args.length < 3) throw new IllegalArgumentException("step <x> <y> <z> [len]");
            if (args.length >= 4) len = Double.parseDouble(args[3]);
            double tx = Double.parseDouble(args[0]);
            double ty = Double.parseDouble(args[1]);
            double tz = Double.parseDouble(args[2]);
            dir = new Vector(tx - cur.getX(), 0, tz - cur.getZ());
            if (dir.lengthSquared() < 1e-6) {
                return ok(sender, "step", fmt(cur), t0, "\"moved\":false,\"reason\":\"already_there\"");
            }
            dir.normalize().multiply(Math.min(len, dir.length()));
            targetLabel = tx + "," + ty + "," + tz;
            // Face the horizontal target
            Location eye = p.getEyeLocation();
            Vector look = new Vector(tx - eye.getX(), ty + 0.5 - eye.getY(), tz - eye.getZ());
            if (look.lengthSquared() > 1e-6) {
                Location tmp = eye.clone();
                tmp.setDirection(look);
                p.setRotation(tmp.getYaw(), tmp.getPitch());
            }
        }
        Location next = tryStep(p, cur, dir);
        if (next == null) {
            return json(sender, false, "step", targetLabel, System.currentTimeMillis() - t0,
                    "blocked", "\"from\":" + quote(fmt(cur)));
        }
        boolean ok = p.teleport(next);
        double remaining = args[0].equalsIgnoreCase("forward") ? -1
                : next.distance(new Location(next.getWorld(),
                Double.parseDouble(args[0]), Double.parseDouble(args[1]), Double.parseDouble(args[2])));
        return json(sender, ok, "step", targetLabel, System.currentTimeMillis() - t0,
                ok ? null : "teleport_failed",
                "\"x\":" + next.getX() + ",\"y\":" + next.getY() + ",\"z\":" + next.getZ()
                        + ",\"remaining\":" + remaining);
    }

    /**
     * Greedy navigate to coordinates by repeating {@link #step} until arrival or timeout.
     * Usage: {@code move_to <x> <y> <z> [timeout_ms=10000] [arrive=1.5] [step_len=0.8]}
     *
     * <p>This is <b>not</b> A* / Mineflayer-pathfinder. It succeeds on open/near-open terrain;
     * maze-like obstacles may return {@code stuck} or {@code timeout}.
     */
    private static boolean moveTo(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 3) throw new IllegalArgumentException("move_to <x> <y> <z> [timeout_ms] [arrive] [step_len]");
        double tx = Double.parseDouble(args[0]);
        double ty = Double.parseDouble(args[1]);
        double tz = Double.parseDouble(args[2]);
        long timeoutMs = args.length >= 4 ? Long.parseLong(args[3]) : 10000L;
        double arrive = args.length >= 5 ? Double.parseDouble(args[4]) : 1.5;
        double stepLen = args.length >= 6 ? Double.parseDouble(args[5]) : 0.8;
        World w = p.getWorld();
        Location goal = new Location(w, tx, ty, tz);
        int steps = 0;
        int stalled = 0;
        final int maxSteps = 250; // hard cap so RCON primary-thread navigation cannot hang the server
        double lastDist = p.getLocation().distance(goal);
        while (System.currentTimeMillis() - t0 < timeoutMs && steps < maxSteps) {
            Location cur = p.getLocation();
            double dist = cur.distance(goal);
            if (dist <= arrive) {
                return json(sender, true, "move_to", fmt(goal), System.currentTimeMillis() - t0, null,
                        "\"steps\":" + steps + ",\"final_distance\":" + dist
                                + ",\"x\":" + cur.getX() + ",\"y\":" + cur.getY() + ",\"z\":" + cur.getZ()
                                + ",\"navigator\":\"greedy_step\"");
            }
            Vector horiz = new Vector(tx - cur.getX(), 0, tz - cur.getZ());
            if (horiz.lengthSquared() < 1e-6) {
                // Only Y remains — teleport vertically if clear
                Location vertical = cur.clone();
                vertical.setY(ty);
                if (isStandable(vertical)) {
                    p.teleport(vertical);
                    steps++;
                    continue;
                }
                return json(sender, false, "move_to", fmt(goal), System.currentTimeMillis() - t0,
                        "vertical_blocked", "\"steps\":" + steps + ",\"final_distance\":" + dist);
            }
            double len = Math.min(stepLen, horiz.length());
            Vector dir = horiz.normalize().multiply(len);
            Location eye = p.getEyeLocation();
            Vector look = new Vector(tx - eye.getX(), ty + 0.5 - eye.getY(), tz - eye.getZ());
            if (look.lengthSquared() > 1e-6) {
                Location tmp = eye.clone();
                tmp.setDirection(look);
                p.setRotation(tmp.getYaw(), tmp.getPitch());
            }
            Location next = tryStep(p, cur, dir);
            if (next == null) {
                // Try slight left/right offsets before declaring stuck
                Vector left = new Vector(-dir.getZ(), 0, dir.getX()).normalize().multiply(len);
                Vector right = new Vector(dir.getZ(), 0, -dir.getX()).normalize().multiply(len);
                next = tryStep(p, cur, left);
                if (next == null) next = tryStep(p, cur, right);
            }
            if (next == null) {
                return json(sender, false, "move_to", fmt(goal), System.currentTimeMillis() - t0,
                        "stuck", "\"steps\":" + steps + ",\"final_distance\":" + dist
                                + ",\"x\":" + cur.getX() + ",\"y\":" + cur.getY() + ",\"z\":" + cur.getZ());
            }
            if (!p.teleport(next)) {
                return json(sender, false, "move_to", fmt(goal), System.currentTimeMillis() - t0,
                        "teleport_failed", "\"steps\":" + steps);
            }
            steps++;
            double newDist = p.getLocation().distance(goal);
            if (newDist >= lastDist - 0.01) {
                if (++stalled >= 8) {
                    return json(sender, false, "move_to", fmt(goal), System.currentTimeMillis() - t0,
                            "no_progress", "\"steps\":" + steps + ",\"final_distance\":" + newDist);
                }
            } else {
                stalled = 0;
            }
            lastDist = newDist;
        }
        Location cur = p.getLocation();
        return json(sender, false, "move_to", fmt(goal), System.currentTimeMillis() - t0,
                "timeout", "\"steps\":" + steps + ",\"final_distance\":" + cur.distance(goal)
                        + ",\"x\":" + cur.getX() + ",\"y\":" + cur.getY() + ",\"z\":" + cur.getZ());
    }

    /** Probe a candidate foot position: solid below, air for feet+head. Allows ±1 block step-up/down. */
    private static Location tryStep(Player p, Location from, Vector delta) {
        World w = from.getWorld();
        if (w == null) return null;
        double nx = from.getX() + delta.getX();
        double nz = from.getZ() + delta.getZ();
        int baseY = from.getBlockY();
        for (int yHint : new int[]{baseY + 1, baseY, baseY - 1}) {
            Location grounded = groundAt(w, nx, nz, yHint + 2);
            if (grounded == null) continue;
            if (from.getY() - grounded.getY() > 2.1) continue; // reject cliffs
            grounded.setYaw(from.getYaw());
            grounded.setPitch(from.getPitch());
            if (isStandable(grounded)) return grounded;
        }
        return null;
    }

    private static Location groundAt(World w, double x, double z, int startY) {
        int minY = w.getMinHeight() + 1;
        for (int y = Math.min(startY, w.getMaxHeight() - 2); y >= minY; y--) {
            Location foot = new Location(w, x, y, z);
            if (isStandable(foot)) return foot;
        }
        return null;
    }

    private static boolean isStandable(Location foot) {
        World w = foot.getWorld();
        if (w == null) return false;
        int x = foot.getBlockX();
        int y = foot.getBlockY();
        int z = foot.getBlockZ();
        w.getChunkAt(x >> 4, z >> 4).load(true);
        Block below = w.getBlockAt(x, y - 1, z);
        Block at = w.getBlockAt(x, y, z);
        Block above = w.getBlockAt(x, y + 1, z);
        if (!below.getType().isSolid()) return false;
        if (at.getType().isSolid()) return false;
        if (above.getType().isSolid()) return false;
        // Keep fractional xz; integer y is the floor the player stands on
        foot.setY(y);
        return true;
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

    private static boolean craftItem(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 2) throw new IllegalArgumentException("craft_item <MATERIAL> [amount]");
        Material mat = Material.valueOf(args[0].toUpperCase(Locale.ROOT));
        int amount = args.length >= 2 ? Integer.parseInt(args[1]) : 1;
        // Crafting consumes materials from the player's inventory.
        ItemStack[] contents = p.getInventory().getContents();
        int have = 0;
        for (ItemStack stack : contents) {
            if (stack != null && stack.getType() == mat) {
                have += stack.getAmount();
            }
        }
        if (have < amount) {
            return json(sender, false, "craft_item", mat.name(), System.currentTimeMillis() - t0,
                    "insufficient_materials",
                    "\"have\":" + have + ",\"need\":" + amount);
        }
        // Remove the required materials.
        int remaining = amount;
        for (int i = 0; i < contents.length; i++) {
            ItemStack stack = contents[i];
            if (stack != null && stack.getType() == mat) {
                if (stack.getAmount() >= remaining) {
                    if (stack.getAmount() == remaining) {
                        p.getInventory().setItem(i, null);
                    } else {
                        stack.setAmount(stack.getAmount() - remaining);
                        p.getInventory().setItem(i, stack);
                    }
                    remaining = 0;
                    break;
                } else {
                    remaining -= stack.getAmount();
                    p.getInventory().setItem(i, null);
                }
            }
        }
        // Add the crafted items.
        ItemStack crafted = new ItemStack(mat, amount);
        var leftover = p.getInventory().addItem(crafted);
        boolean ok = leftover.isEmpty();
        return json(sender, ok, "craft_item", mat.name(), System.currentTimeMillis() - t0,
                ok ? null : "inventory_full",
                "\"amount\":" + amount + ",\"leftover\":" + leftover.values().stream()
                        .mapToInt(ItemStack::getAmount).sum());
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

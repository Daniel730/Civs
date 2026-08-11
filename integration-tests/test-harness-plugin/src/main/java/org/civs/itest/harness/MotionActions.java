package org.civs.itest.harness;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

/**
 * Continuous motion capabilities: agent pathfinding + walking, and cinematic camera work.
 *
 * <p><b>Why this exists.</b> The original {@code step} / {@code move_to} actions teleported the
 * player once per RCON round trip (~0.45 blocks per 250&nbsp;ms) with an instant yaw snap. Observers
 * saw position jumps instead of a walk cycle, and every wall produced {@code stuck} because only a
 * single candidate cell was probed. Both the stutter and the latency are structural: the motion has
 * to be produced by the server on its own clock, not by the Node runner over RCON.
 *
 * <p>So each capability here <b>starts a scheduled task and returns immediately</b>. The task runs
 * on the primary thread every tick and does the interpolation; Node polls a cheap status action.
 * One RCON call now buys a whole smooth traversal or camera move.
 *
 * <p>Movement is still ordinary {@link Player#teleport(Location)} — protocol bots never send
 * movement packets, so the server cannot simulate them. The difference is granularity and
 * continuity: ~0.2 blocks every tick with limited yaw rate, acceleration ramps and step-up hops,
 * which is what other clients interpolate into a normal walk animation.
 */
final class MotionActions {

    private MotionActions() {}

    /** Vanilla walk speed (blocks/second). Sprint is ~5.6. */
    private static final double WALK_SPEED = 4.3;
    /** Max yaw change per tick, degrees. Humans do not snap 180 degrees instantly. */
    private static final double MAX_YAW_RATE = 14.0;
    /** Max pitch change per tick, degrees. */
    private static final double MAX_PITCH_RATE = 9.0;
    /** A* node budget — bounded so a bad goal cannot stall the primary thread. */
    private static final int DEFAULT_MAX_NODES = 6000;
    /** Hard cap on horizontal search radius from the start cell. */
    private static final int MAX_SEARCH_RADIUS = 96;
    /** Ticks the mover tolerates without covering ground before reporting stuck. */
    private static final int STUCK_TICK_LIMIT = 40;
    /** Server-side re-plans allowed per walk before the failure is handed back to the agent. */
    private static final int MAX_REPLANS = 2;
    /** Camera never sits closer than this to its subject. */
    private static final double MIN_CAM_DISTANCE = 2.0;
    /**
     * Above this gap between rig and shot the move stops being a move.
     *
     * Measured: a fresh rig eased toward a subject 7.3 km away at 10% per tick spent over 30 s
     * flying across the world with the subject a speck in frame (probe-camera: framing distance
     * mean 6106 blocks). Film grammar agrees with the fix — a change of place is a cut.
     */
    private static final double CAM_CUT_DISTANCE = 40.0;
    /** Look-ahead is capped so a teleporting subject cannot aim the rig into terrain. */
    private static final double MAX_SUBJECT_VEL = 0.6;
    /** A per-tick delta larger than this is a teleport, not motion — do not extrapolate it. */
    private static final double TELEPORT_DELTA = 2.0;

    private static final Map<UUID, Mover> MOVERS = new HashMap<>();
    private static final Map<UUID, MoveResult> LAST_MOVE = new HashMap<>();
    private static final Map<UUID, CamTracker> CAMERAS = new HashMap<>();

    // ---------------------------------------------------------------- dispatch

    /**
     * @return true when {@code action} was a motion action (already answered), false to let the
     *     caller fall through to its own switch.
     */
    static Boolean dispatch(CommandSender sender, Player p, String action, String[] args,
                            long t0, TestHarnessPlugin plugin) {
        switch (action) {
            case "walk_path":   return walkPath(sender, p, args, t0, plugin);
            case "walk_status": return walkStatus(sender, p, t0);
            case "walk_stop":   return walkStop(sender, p, t0);
            case "cam_shot":    return camShot(sender, p, args, t0, plugin);
            case "cam_status":  return camStatus(sender, p, t0);
            case "cam_stop":    return camStop(sender, p, t0);
            case "los":         return los(sender, p, args, t0);
            default:            return null;
        }
    }

    /** Cancel every scheduled task (plugin disable / server shutdown). */
    static void shutdown() {
        for (Mover m : new ArrayList<>(MOVERS.values())) m.cancel("shutdown");
        for (CamTracker c : new ArrayList<>(CAMERAS.values())) c.cancel("shutdown");
        MOVERS.clear();
        CAMERAS.clear();
    }

    // ---------------------------------------------------------------- walking

    /**
     * Plan a path with bounded A* and start walking it.
     * Usage: {@code walk_path <x> <y> <z> [arrive=1.2] [speed=4.3] [maxNodes=6000]}
     */
    private static boolean walkPath(CommandSender sender, Player p, String[] args, long t0,
                                    TestHarnessPlugin plugin) {
        if (args.length < 3) {
            return json(sender, false, "walk_path", null, t0, "bad_args", "\"usage\":\"walk_path <x> <y> <z> [arrive] [speed] [maxNodes]\"");
        }
        double gx = Double.parseDouble(args[0]);
        double gy = Double.parseDouble(args[1]);
        double gz = Double.parseDouble(args[2]);
        double arrive = args.length >= 4 ? Double.parseDouble(args[3]) : 1.2;
        double speed = args.length >= 5 ? Double.parseDouble(args[4]) : WALK_SPEED;
        int maxNodes = args.length >= 6 ? Integer.parseInt(args[5]) : DEFAULT_MAX_NODES;
        if (speed <= 0.2) speed = 0.2;
        if (speed > 8.0) speed = 8.0;
        if (maxNodes < 200) maxNodes = 200;
        if (maxNodes > 20000) maxNodes = 20000;

        Mover existing = MOVERS.remove(p.getUniqueId());
        if (existing != null) existing.cancel("superseded");

        World w = p.getWorld();
        Location start = p.getLocation();
        PathSearch search = findPath(w, start, new Location(w, gx, gy, gz), arrive, maxNodes);
        if (search.path == null) {
            LAST_MOVE.put(p.getUniqueId(), new MoveResult(false, search.reason, 0,
                    horizDist(start, new Location(w, gx, gy, gz)), 0, 0, 0));
            return json(sender, false, "walk_path", fmt(new Location(w, gx, gy, gz)), t0, search.reason,
                    "\"nodes_explored\":" + search.explored
                            + ",\"distance_to_goal\":" + round(horizDist(start, new Location(w, gx, gy, gz))));
        }

        Mover mover = new Mover(p, search.path, arrive, speed, plugin);
        MOVERS.put(p.getUniqueId(), mover);
        mover.start();
        double pathLen = mover.pathLength();
        return json(sender, true, "walk_path", fmt(search.path.get(search.path.size() - 1)), t0, null,
                "\"waypoints\":" + search.path.size()
                        + ",\"nodes_explored\":" + search.explored
                        + ",\"path_length\":" + round(pathLen)
                        + ",\"eta_ms\":" + (long) (pathLen / speed * 1000.0)
                        + ",\"speed\":" + round(speed));
    }

    /** Progress of the active (or last) walk. Cheap: no world access. */
    private static boolean walkStatus(CommandSender sender, Player p, long t0) {
        Mover mover = MOVERS.get(p.getUniqueId());
        if (mover != null && mover.active) {
            return json(sender, true, "walk_status", p.getName(), t0, null,
                    "\"active\":true"
                            + ",\"waypoint\":" + mover.index
                            + ",\"waypoints\":" + mover.path.size()
                            + ",\"distance_to_goal\":" + round(mover.distanceToGoal())
                            + ",\"travelled\":" + round(mover.travelled)
                            + ",\"stuck_ticks\":" + mover.stuckTicks
                            + ",\"stuck_ms\":" + mover.stuckTicks * 50
                            + ",\"collisions\":" + mover.collisions
                            + ",\"replans\":" + mover.replans
                            + ",\"no_progress_ms\":" + mover.noProgressMs()
                            + ",\"damage_taken\":" + round(mover.damageTaken)
                            + ",\"done\":false");
        }
        MoveResult last = LAST_MOVE.get(p.getUniqueId());
        if (last == null) {
            return json(sender, false, "walk_status", p.getName(), t0, "no_walk", "\"active\":false");
        }
        return json(sender, last.success, "walk_status", p.getName(), t0, last.reason,
                "\"active\":false"
                        + ",\"done\":true"
                        + ",\"distance_to_goal\":" + round(last.distanceToGoal)
                        + ",\"travelled\":" + round(last.travelled)
                        + ",\"stuck_ms\":" + last.stuckMs
                        + ",\"collisions\":" + last.collisions
                        + ",\"replans\":" + last.replans);
    }

    private static boolean walkStop(CommandSender sender, Player p, long t0) {
        Mover mover = MOVERS.remove(p.getUniqueId());
        if (mover == null) {
            return json(sender, false, "walk_stop", p.getName(), t0, "no_walk", null);
        }
        mover.cancel("stopped");
        return json(sender, true, "walk_stop", p.getName(), t0, null, "\"travelled\":" + round(mover.travelled));
    }

    // ---------------------------------------------------------------- camera

    /**
     * Start (or retarget) a tracking cinematic shot.
     * Usage: {@code cam_shot <subject> <shot> [dist] [height] [yawDeg] [durationMs] [lead]}
     *
     * <p>The shot vocabulary and its timing live in the Node director; this only executes a
     * resolved shot: occlusion-aware placement, camera collision, eased transition, live tracking
     * with velocity look-ahead.
     */
    private static boolean camShot(CommandSender sender, Player cam, String[] args, long t0,
                                  TestHarnessPlugin plugin) {
        if (args.length < 2) {
            return json(sender, false, "cam_shot", null, t0, "bad_args",
                    "\"usage\":\"cam_shot <subject> <shot> [dist] [height] [yawDeg] [durationMs] [lead]\"");
        }
        String subjectName = args[0];
        String shot = args[1].toLowerCase(Locale.ROOT);
        double dist = args.length >= 3 ? Double.parseDouble(args[2]) : 6.0;
        double height = args.length >= 4 ? Double.parseDouble(args[3]) : 2.2;
        double yawDeg = args.length >= 5 ? Double.parseDouble(args[4]) : 45.0;
        long durationMs = args.length >= 6 ? Long.parseLong(args[5]) : 1200L;
        double lead = args.length >= 7 ? Double.parseDouble(args[6]) : 6.0;

        Player subject = Bukkit.getPlayerExact(subjectName);
        if (subject == null || !subject.isOnline()) {
            CamTracker t = CAMERAS.get(cam.getUniqueId());
            if (t != null) t.subjectLost++;
            return json(sender, false, "cam_shot", subjectName, t0, "subject_offline", null);
        }
        if (dist < MIN_CAM_DISTANCE) dist = MIN_CAM_DISTANCE;
        if (dist > 48) dist = 48;
        if (durationMs < 0) durationMs = 0;
        if (durationMs > 10000) durationMs = 10000;

        CamTracker tracker = CAMERAS.get(cam.getUniqueId());
        if (tracker == null || !tracker.active) {
            tracker = new CamTracker(cam, plugin);
            CAMERAS.put(cam.getUniqueId(), tracker);
            tracker.start();
        }
        tracker.retarget(subject, shot, dist, height, yawDeg, durationMs, lead);
        Pose resolved = tracker.resolveTarget();
        return json(sender, true, "cam_shot", subjectName, t0, null,
                "\"shot\":" + quote(shot)
                        + ",\"transition_ms\":" + durationMs
                        + ",\"target\":{\"x\":" + round(resolved.x) + ",\"y\":" + round(resolved.y)
                        + ",\"z\":" + round(resolved.z) + "}"
                        + ",\"distance\":" + round(resolved.distance)
                        + ",\"occluded\":" + resolved.wasOccluded
                        + ",\"repositioned\":" + resolved.wasRepositioned);
    }

    private static boolean camStatus(CommandSender sender, Player cam, long t0) {
        CamTracker t = CAMERAS.get(cam.getUniqueId());
        if (t == null) {
            return json(sender, false, "cam_status", cam.getName(), t0, "no_shot", "\"active\":false");
        }
        return json(sender, true, "cam_status", cam.getName(), t0, null,
                "\"active\":" + t.active
                        + ",\"shot\":" + quote(t.shot == null ? "" : t.shot)
                        + ",\"subject\":" + quote(t.subjectName == null ? "" : t.subjectName)
                        + ",\"transitioning\":" + (t.transitionTicksLeft > 0)
                        + ",\"distance\":" + round(t.lastDistance)
                        + ",\"occlusion_events\":" + t.occlusionEvents
                        + ",\"reposition_events\":" + t.repositionEvents
                        + ",\"subject_lost\":" + t.subjectLost
                        + ",\"cuts\":" + t.cuts
                        + ",\"ticks\":" + t.ticks);
    }

    private static boolean camStop(CommandSender sender, Player cam, long t0) {
        CamTracker t = CAMERAS.remove(cam.getUniqueId());
        if (t == null) return json(sender, false, "cam_stop", cam.getName(), t0, "no_shot", null);
        t.cancel("stopped");
        return json(sender, true, "cam_stop", cam.getName(), t0, null, "\"ticks\":" + t.ticks);
    }

    /**
     * Line of sight from the player's eye to a point.
     * Usage: {@code los <x> <y> <z>}
     */
    private static boolean los(CommandSender sender, Player p, String[] args, long t0) {
        if (args.length < 3) {
            return json(sender, false, "los", null, t0, "bad_args", "\"usage\":\"los <x> <y> <z>\"");
        }
        Location eye = p.getEyeLocation();
        Location target = new Location(p.getWorld(),
                Double.parseDouble(args[0]), Double.parseDouble(args[1]), Double.parseDouble(args[2]));
        Block hit = firstBlocker(eye, target);
        double distance = eye.distance(target);
        if (hit == null) {
            return json(sender, true, "los", fmt(target), t0, null,
                    "\"clear\":true,\"distance\":" + round(distance));
        }
        return json(sender, true, "los", fmt(target), t0, null,
                "\"clear\":false,\"distance\":" + round(distance)
                        + ",\"hit\":{\"x\":" + hit.getX() + ",\"y\":" + hit.getY() + ",\"z\":" + hit.getZ()
                        + ",\"material\":" + quote(hit.getType().name()) + "}");
    }

    // ---------------------------------------------------------------- pathfinding

    private static final class PathSearch {
        List<Location> path;
        String reason;
        int explored;
    }

    /**
     * Bounded A* over standable cells, then string-pulled so the result reads as a human route
     * rather than a grid staircase.
     */
    private static PathSearch findPath(World w, Location from, Location to, double arrive, int maxNodes) {
        PathSearch out = new PathSearch();
        Location startCell = groundNear(w, from.getX(), from.getZ(), from.getBlockY() + 2, 4);
        if (startCell == null) {
            out.reason = "start_not_standable";
            return out;
        }
        Location goalCell = groundNear(w, to.getX(), to.getZ(), to.getBlockY() + 2, 6);
        if (goalCell == null) {
            out.reason = "goal_not_standable";
            return out;
        }
        if (horizDist(startCell, goalCell) > MAX_SEARCH_RADIUS) {
            out.reason = "goal_out_of_range";
            return out;
        }

        final int sx = startCell.getBlockX();
        final int sy = startCell.getBlockY();
        final int sz = startCell.getBlockZ();
        final int gxi = goalCell.getBlockX();
        final int gyi = goalCell.getBlockY();
        final int gzi = goalCell.getBlockZ();

        Map<Long, Node> nodes = new HashMap<>();
        PriorityQueue<Node> open = new PriorityQueue<>(Comparator.comparingDouble(n -> n.f));
        Node start = new Node(sx, sy, sz, null, 0, heuristic(sx, sy, sz, gxi, gyi, gzi));
        nodes.put(key(sx, sy, sz), start);
        open.add(start);

        int explored = 0;
        Node best = start;
        while (!open.isEmpty() && explored < maxNodes) {
            Node cur = open.poll();
            if (cur.closed) continue;
            cur.closed = true;
            explored++;
            if (cur.h < best.h) best = cur;
            double distToGoal = Math.sqrt(sq(cur.x + 0.5 - goalCell.getX()) + sq(cur.z + 0.5 - goalCell.getZ()));
            if (distToGoal <= Math.max(arrive, 0.9) && Math.abs(cur.y - gyi) <= 2) {
                out.path = reconstruct(w, cur);
                out.explored = explored;
                return out;
            }
            for (int[] d : NEIGHBOURS) {
                int nx = cur.x + d[0];
                int nz = cur.z + d[1];
                if (Math.abs(nx - sx) > MAX_SEARCH_RADIUS || Math.abs(nz - sz) > MAX_SEARCH_RADIUS) continue;
                // Diagonals require both orthogonal cells to be passable (no corner clipping).
                if (d[0] != 0 && d[1] != 0) {
                    if (!standableColumn(w, cur.x + d[0], cur.z, cur.y)) continue;
                    if (!standableColumn(w, cur.x, cur.z + d[1], cur.y)) continue;
                }
                Location cell = steppableFrom(w, cur.x, cur.y, cur.z, nx, nz);
                if (cell == null) continue;
                int ny = cell.getBlockY();
                long k = key(nx, ny, nz);
                double stepCost = (d[0] != 0 && d[1] != 0) ? 1.414 : 1.0;
                stepCost += Math.abs(ny - cur.y) * 0.6;      // prefer flat ground
                stepCost += terrainPenalty(w, nx, ny, nz);   // avoid water / hazards / tight spots
                double g = cur.g + stepCost;
                Node existing = nodes.get(k);
                if (existing != null && (existing.closed || existing.g <= g)) continue;
                Node next = new Node(nx, ny, nz, cur, g, heuristic(nx, ny, nz, gxi, gyi, gzi));
                nodes.put(k, next);
                open.add(next);
            }
        }
        // Partial route is better than standing still, provided it makes real progress.
        if (best != start && best.h < start.h * 0.6) {
            out.path = reconstruct(w, best);
            out.explored = explored;
            return out;
        }
        out.reason = explored >= maxNodes ? "node_budget_exhausted" : "no_path";
        out.explored = explored;
        return out;
    }

    private static final int[][] NEIGHBOURS = {
            {1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}
    };

    private static final class Node {
        final int x;
        final int y;
        final int z;
        final Node parent;
        final double g;
        final double h;
        final double f;
        boolean closed;

        Node(int x, int y, int z, Node parent, double g, double h) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.parent = parent;
            this.g = g;
            this.h = h;
            this.f = g + h;
        }
    }

    private static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 38) | ((long) (y & 0xFFF) << 26) | (z & 0x3FFFFFF);
    }

    private static double heuristic(int x, int y, int z, int gx, int gy, int gz) {
        return Math.sqrt(sq(x - gx) + sq(z - gz)) + Math.abs(y - gy) * 0.4;
    }

    private static List<Location> reconstruct(World w, Node end) {
        ArrayDeque<Location> stack = new ArrayDeque<>();
        for (Node n = end; n != null; n = n.parent) {
            stack.push(new Location(w, n.x + 0.5, n.y, n.z + 0.5));
        }
        List<Location> raw = new ArrayList<>(stack);
        if (raw.size() > 1) raw.remove(0); // current cell
        return stringPull(w, raw);
    }

    /**
     * Drop waypoints that a straight walk can skip. Turning only where the terrain forces it is
     * what separates a human route from grid zig-zag.
     */
    private static List<Location> stringPull(World w, List<Location> path) {
        if (path.size() <= 2) return path;
        List<Location> out = new ArrayList<>();
        int i = 0;
        while (i < path.size()) {
            int furthest = i;
            for (int j = Math.min(path.size() - 1, i + 12); j > i; j--) {
                if (walkableLine(w, path.get(i), path.get(j))) {
                    furthest = j;
                    break;
                }
            }
            if (furthest == i) furthest = Math.min(i + 1, path.size() - 1);
            out.add(path.get(furthest));
            if (furthest == path.size() - 1) break;
            i = furthest;
        }
        return out;
    }

    /** Sample the straight line between two waypoints; every sample must be standable. */
    private static boolean walkableLine(World w, Location a, Location b) {
        double dx = b.getX() - a.getX();
        double dz = b.getZ() - a.getZ();
        double len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.4) return true;
        int samples = (int) Math.ceil(len / 0.5);
        double prevY = a.getY();
        for (int s = 1; s <= samples; s++) {
            double t = (double) s / samples;
            double x = a.getX() + dx * t;
            double z = a.getZ() + dz * t;
            Location cell = groundNear(w, x, z, (int) Math.round(prevY) + 2, 2);
            if (cell == null) return false;
            if (Math.abs(cell.getY() - prevY) > 1.01) return false;
            prevY = cell.getY();
        }
        return Math.abs(prevY - b.getY()) <= 1.01;
    }

    /** Candidate foot cell when moving from one column into a neighbour: +1 step up, up to -3 drop. */
    private static Location steppableFrom(World w, int fx, int fy, int fz, int nx, int nz) {
        for (int dy : new int[]{1, 0, -1, -2, -3}) {
            int ny = fy + dy;
            if (!isStandable(w, nx, ny, nz)) continue;
            if (dy == 1) {
                // Stepping up needs headroom above the current cell too.
                if (isSolid(w, fx, fy + 2, fz)) continue;
            }
            return new Location(w, nx + 0.5, ny, nz + 0.5);
        }
        return null;
    }

    private static boolean standableColumn(World w, int x, int z, int aroundY) {
        for (int dy : new int[]{0, 1, -1}) {
            if (isStandable(w, x, aroundY + dy, z)) return true;
        }
        return false;
    }

    private static Location groundNear(World w, double x, double z, int startY, int span) {
        int bx = (int) Math.floor(x);
        int bz = (int) Math.floor(z);
        int max = Math.min(startY, w.getMaxHeight() - 3);
        int min = Math.max(w.getMinHeight() + 1, max - (span * 2 + 6));
        for (int y = max; y >= min; y--) {
            if (isStandable(w, bx, y, bz)) return new Location(w, bx + 0.5, y, bz + 0.5);
        }
        return null;
    }

    private static boolean isStandable(World w, int x, int y, int z) {
        if (y <= w.getMinHeight() || y >= w.getMaxHeight() - 1) return false;
        Block below = w.getBlockAt(x, y - 1, z);
        if (!below.getType().isSolid()) return false;
        if (isHazard(below.getType())) return false;
        Block at = w.getBlockAt(x, y, z);
        Block above = w.getBlockAt(x, y + 1, z);
        if (at.getType().isSolid() || above.getType().isSolid()) return false;
        if (isHazard(at.getType()) || isHazard(above.getType())) return false;
        return true;
    }

    private static boolean isSolid(World w, int x, int y, int z) {
        return w.getBlockAt(x, y, z).getType().isSolid();
    }

    private static boolean isHazard(Material m) {
        return m == Material.LAVA || m == Material.FIRE || m == Material.SOUL_FIRE
                || m == Material.MAGMA_BLOCK || m == Material.CAMPFIRE || m == Material.SOUL_CAMPFIRE
                || m == Material.CACTUS || m == Material.SWEET_BERRY_BUSH || m == Material.POWDER_SNOW
                || m == Material.WITHER_ROSE;
    }

    /** Extra A* cost for cells an agent should prefer to avoid but can survive. */
    private static double terrainPenalty(World w, int x, int y, int z) {
        double penalty = 0;
        Material at = w.getBlockAt(x, y, z).getType();
        if (at == Material.WATER) penalty += 4.0;
        if (at == Material.COBWEB) penalty += 8.0;
        Material below = w.getBlockAt(x, y - 1, z).getType();
        if (below == Material.WATER || below == Material.ICE) penalty += 2.0;
        // Discourage walking along a ledge with a long drop beside it.
        if (!isSolid(w, x, y - 2, z) && !isSolid(w, x, y - 3, z) && !isSolid(w, x, y - 4, z)) {
            penalty += 1.0;
        }
        return penalty;
    }

    // ---------------------------------------------------------------- mover

    private static final class MoveResult {
        final boolean success;
        final String reason;
        final double travelled;
        final double distanceToGoal;
        final long stuckMs;
        final int collisions;
        final int replans;

        MoveResult(boolean success, String reason, double travelled, double distanceToGoal,
                   long stuckMs, int collisions, int replans) {
            this.success = success;
            this.reason = reason;
            this.travelled = travelled;
            this.distanceToGoal = distanceToGoal;
            this.stuckMs = stuckMs;
            this.collisions = collisions;
            this.replans = replans;
        }
    }

    /** Per-tick walker: eased speed, rate-limited yaw, step-up hops, hazard abort. */
    private static final class Mover {
        private final Player player;
        List<Location> path;
        private final double arrive;
        private final double speed;
        private final TestHarnessPlugin plugin;
        private BukkitTask task;

        boolean active = true;
        int index = 0;
        double travelled = 0;
        int stuckTicks = 0;
        int collisions = 0;
        int replans = 0;
        double damageTaken = 0;
        private int ticks = 0;
        private double lastRemaining = Double.MAX_VALUE;
        private double currentSpeed = 0;
        private double lastHealth;

        Mover(Player player, List<Location> path, double arrive, double speed, TestHarnessPlugin plugin) {
            this.player = player;
            this.path = path;
            this.arrive = arrive;
            this.speed = speed;
            this.plugin = plugin;
            this.lastHealth = player.getHealth();
        }

        void start() {
            task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
        }

        double pathLength() {
            double sum = 0;
            Location prev = player.getLocation();
            for (Location wp : path) {
                sum += horizDist(prev, wp);
                prev = wp;
            }
            return sum;
        }

        double distanceToGoal() {
            if (path.isEmpty()) return 0;
            return horizDist(player.getLocation(), path.get(path.size() - 1));
        }

        long noProgressMs() {
            return stuckTicks * 50L;
        }

        void cancel(String reason) {
            finish(false, reason);
        }

        private void finish(boolean success, String reason) {
            if (!active) return;
            active = false;
            if (task != null) task.cancel();
            try {
                player.setSprinting(false);
            } catch (Exception ignored) {
                // player may already be offline
            }
            LAST_MOVE.put(player.getUniqueId(), new MoveResult(success, reason, travelled,
                    distanceToGoal(), stuckTicks * 50L, collisions, replans));
            MOVERS.remove(player.getUniqueId(), this);
        }

        private void tick() {
            if (!player.isOnline()) {
                finish(false, "player_offline");
                return;
            }
            if (player.isDead() || player.getHealth() <= 0) {
                finish(false, "died");
                return;
            }
            double health = player.getHealth();
            if (health < lastHealth - 0.01) {
                damageTaken += lastHealth - health;
                // A stubbed toe (settling fall damage after a teleport) must not abort the route,
                // but sustained damage is a survival decision the Node layer has to make.
                boolean serious = (lastHealth - health) >= 3.0 || damageTaken >= 5.0 || health <= 6.0;
                if (serious && ticks > 6) {
                    finish(false, "took_damage");
                    return;
                }
            }
            lastHealth = health;
            ticks++;

            if (index >= path.size()) {
                finish(true, null);
                return;
            }
            Location cur = player.getLocation();
            Location target = path.get(index);
            double remaining = horizDist(cur, target);
            if (remaining <= 0.35) {
                index++;
                if (index >= path.size()) {
                    finish(true, null);
                    return;
                }
                target = path.get(index);
                remaining = horizDist(cur, target);
            }

            boolean lastLeg = index == path.size() - 1;
            double goalRemaining = distanceToGoal();
            if (lastLeg && goalRemaining <= arrive) {
                finish(true, null);
                return;
            }

            // Ease in over ~8 ticks, ease out over the final 1.5 blocks: no instant start/stop.
            double accel = Math.min(1.0, ticks / 8.0);
            double brake = lastLeg ? Math.min(1.0, Math.max(0.25, goalRemaining / 1.5)) : 1.0;
            double desired = speed * accel * brake;
            currentSpeed += (desired - currentSpeed) * 0.35;
            double stepLen = Math.min(currentSpeed / 20.0, remaining);
            if (stepLen < 0.01) stepLen = 0.01;

            double dx = target.getX() - cur.getX();
            double dz = target.getZ() - cur.getZ();
            double len = Math.sqrt(dx * dx + dz * dz);
            if (len < 1e-6) {
                index++;
                return;
            }
            double nx = cur.getX() + dx / len * stepLen;
            double nz = cur.getZ() + dz / len * stepLen;

            World w = player.getWorld();
            Location next = resolveFoot(w, nx, nz, cur.getBlockY());
            if (next == null) {
                collisions++;
                // Slide along the obstacle before giving up — this is what makes doorways work.
                Location slid = trySlide(w, cur, dx / len, dz / len, stepLen);
                if (slid == null) {
                    stuckTicks++;
                    if (stuckTicks >= STUCK_TICK_LIMIT) {
                        // A route the body cannot follow is a planning problem: re-plan from where
                        // the body actually is before declaring the goal unreachable.
                        if (!replan()) finish(false, "blocked");
                    }
                    return;
                }
                next = slid;
            }

            boolean stepUp = next.getBlockY() > cur.getBlockY();
            // Look a little further down the path than the immediate step: anticipates turns.
            Location lookAt = lookAhead();
            float[] rot = smoothRotation(cur, lookAt);
            next.setYaw(rot[0]);
            next.setPitch(rot[1]);

            if (player.teleport(next)) {
                travelled += horizDist(cur, next);
                if (stepUp) {
                    // Visible hop instead of a silent vertical snap.
                    Vector v = player.getVelocity().clone();
                    if (v.getY() < 0.30) v.setY(0.30);
                    player.setVelocity(v);
                }
            } else {
                collisions++;
            }

            try {
                player.setSprinting(currentSpeed > 4.6);
            } catch (Exception ignored) {
                // cosmetic only
            }

            double newRemaining = distanceToGoal();
            if (newRemaining >= lastRemaining - 0.02) {
                stuckTicks++;
                if (stuckTicks >= STUCK_TICK_LIMIT) {
                    if (!replan()) finish(false, "no_progress");
                    return;
                }
            } else {
                stuckTicks = 0;
            }
            lastRemaining = newRemaining;
        }

        /**
         * Re-plan to the same goal from the current position. Bounded, because a goal that cannot
         * be reached must eventually be reported to the Node layer rather than retried forever.
         *
         * @return false when the retry budget is spent or no path exists any more
         */
        private boolean replan() {
            if (replans >= MAX_REPLANS || path.isEmpty()) return false;
            Location goal = path.get(path.size() - 1);
            PathSearch search = findPath(player.getWorld(), player.getLocation(), goal, arrive,
                    DEFAULT_MAX_NODES);
            if (search.path == null || search.path.isEmpty()) return false;
            replans++;
            path = search.path;
            index = 0;
            stuckTicks = 0;
            currentSpeed = 0;
            lastRemaining = Double.MAX_VALUE;
            return true;
        }

        /** Point ~2.5 blocks along the remaining route, so the head leads the body into turns. */
        private Location lookAhead() {
            double budget = 2.5;
            Location from = player.getLocation();
            for (int i = index; i < path.size(); i++) {
                Location wp = path.get(i);
                double d = horizDist(from, wp);
                if (d >= budget || i == path.size() - 1) return wp;
                budget -= d;
                from = wp;
            }
            return path.get(path.size() - 1);
        }

        private float[] smoothRotation(Location cur, Location lookAt) {
            Vector dir = new Vector(lookAt.getX() - cur.getX(),
                    (lookAt.getY() + 1.2) - (cur.getY() + player.getEyeHeight()),
                    lookAt.getZ() - cur.getZ());
            Location tmp = cur.clone();
            if (dir.lengthSquared() > 1e-6) tmp.setDirection(dir);
            return new float[]{
                    approachAngle(cur.getYaw(), tmp.getYaw(), MAX_YAW_RATE),
                    (float) clamp(approachAngle(cur.getPitch(), tmp.getPitch(), MAX_PITCH_RATE), -35, 35),
            };
        }

        private Location trySlide(World w, Location cur, double ux, double uz, double stepLen) {
            double[][] variants = {
                    {-uz, ux}, {uz, -ux},                       // 90 degrees either side
                    {ux * 0.5 - uz * 0.87, uz * 0.5 + ux * 0.87},
                    {ux * 0.5 + uz * 0.87, uz * 0.5 - ux * 0.87},
            };
            for (double[] v : variants) {
                double vlen = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
                if (vlen < 1e-6) continue;
                double cx = cur.getX() + v[0] / vlen * stepLen;
                double cz = cur.getZ() + v[1] / vlen * stepLen;
                Location cand = resolveFoot(w, cx, cz, cur.getBlockY());
                if (cand != null) return cand;
            }
            return null;
        }

        /**
         * Foot position for a horizontal step, allowing a one-block step up and a drop a player
         * would take without thinking.
         *
         * <p>The original ±2 window could not leave a rooftop or a ledge: probe-camera measured a
         * 57-block route that reported 40 collisions and 0 blocks travelled because the actor stood
         * 6 blocks above the planned path and every candidate foot cell was air.
         */
        private Location resolveFoot(World w, double x, double z, int baseY) {
            for (int dy : new int[]{0, 1, -1, -2, -3, -4}) {
                int y = baseY + dy;
                if (isStandable(w, (int) Math.floor(x), y, (int) Math.floor(z))) {
                    return new Location(w, x, y, z);
                }
            }
            return null;
        }
    }

    // ---------------------------------------------------------------- camera tracker

    private static final class Pose {
        double x;
        double y;
        double z;
        double lookX;
        double lookY;
        double lookZ;
        double distance;
        boolean wasOccluded;
        boolean wasRepositioned;
    }

    /**
     * Per-tick camera operator. Holds a shot description, resolves an unoccluded and
     * non-clipping position every tick, then eases the rig toward it while looking at a
     * velocity-extrapolated point on the subject.
     */
    private static final class CamTracker {
        private final Player cam;
        private final TestHarnessPlugin plugin;
        private BukkitTask task;

        boolean active = true;
        String shot = "medium";
        String subjectName;
        private Player subject;
        private double dist = 6;
        private double height = 2.2;
        private double yawDeg = 45;
        private double lead = 6;
        int transitionTicksLeft = 0;
        private int transitionTicks = 0;

        int ticks = 0;
        int occlusionEvents = 0;
        int repositionEvents = 0;
        int subjectLost = 0;
        int cuts = 0;
        double lastDistance = 0;

        private Location subjectPrev;
        private Vector subjectVel = new Vector();
        private Location camPos;
        private Location lookPos;

        CamTracker(Player cam, TestHarnessPlugin plugin) {
            this.cam = cam;
            this.plugin = plugin;
            this.camPos = cam.getLocation().clone();
        }

        void start() {
            task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
        }

        void cancel(String reason) {
            active = false;
            if (task != null) task.cancel();
            CAMERAS.remove(cam.getUniqueId(), this);
        }

        void retarget(Player newSubject, String newShot, double newDist, double newHeight,
                      double newYaw, long durationMs, double newLead) {
            if (subject == null || !newSubject.equals(subject)) {
                subjectPrev = null;
                subjectVel = new Vector();
            }
            subject = newSubject;
            subjectName = newSubject.getName();
            shot = newShot;
            dist = newDist;
            height = newHeight;
            yawDeg = newYaw;
            lead = newLead;
            transitionTicks = Math.max(1, (int) (durationMs / 50L));
            transitionTicksLeft = transitionTicks;
        }

        /** Where the rig wants to be right now, occlusion and collision resolved. */
        Pose resolveTarget() {
            Pose pose = new Pose();
            Location sLoc = subject.getLocation();
            World w = sLoc.getWorld();
            // Look-ahead: aim where the subject will be, not where it was.
            Location aim = sLoc.clone().add(subjectVel.clone().multiply(lead));
            aim.setY(sLoc.getY() + 1.2);
            pose.lookX = aim.getX();
            pose.lookY = aim.getY();
            pose.lookZ = aim.getZ();

            double baseYaw = Math.toRadians(sLoc.getYaw() + 180.0 + yawDeg);
            double useDist = dist;
            double useHeight = height;
            if ("top_down".equals(shot)) {
                useHeight = Math.max(height, dist);
                useDist = Math.max(1.5, dist * 0.35);
            } else if ("low".equals(shot)) {
                useHeight = Math.min(height, 0.6);
            }

            Location candidate = null;
            // Try the intended angle, then rotate away in 40-degree steps, then lift.
            for (int attempt = 0; attempt < 14 && candidate == null; attempt++) {
                int ring = attempt / 9;
                double yawTry = baseYaw + Math.toRadians((attempt % 9) * 40.0);
                double heightTry = useHeight + ring * 2.5;
                double distTry = useDist;
                Location c = new Location(w,
                        sLoc.getX() + Math.cos(yawTry) * distTry,
                        sLoc.getY() + heightTry,
                        sLoc.getZ() + Math.sin(yawTry) * distTry);
                Location fitted = pullIn(aim, c);
                if (fitted == null) {
                    if (attempt == 0) pose.wasOccluded = true;
                    continue;
                }
                if (attempt > 0) {
                    pose.wasRepositioned = true;
                    if (!pose.wasOccluded) pose.wasOccluded = true;
                }
                candidate = fitted;
            }
            if (candidate == null) {
                // Last resort: straight above the subject, which is essentially always clear.
                candidate = new Location(w, sLoc.getX(), sLoc.getY() + Math.max(6, useHeight), sLoc.getZ());
                pose.wasRepositioned = true;
            }
            pose.x = candidate.getX();
            pose.y = candidate.getY();
            pose.z = candidate.getZ();
            pose.distance = candidate.distance(sLoc);
            return pose;
        }

        /**
         * Slide the camera along the ray from the subject until it is both outside geometry and
         * has line of sight. Returns null when even the closest allowed position is blocked.
         */
        private Location pullIn(Location aim, Location candidate) {
            World w = aim.getWorld();
            Vector toCam = candidate.toVector().subtract(aim.toVector());
            double full = toCam.length();
            if (full < 1e-6) return null;
            Vector unit = toCam.clone().multiply(1.0 / full);
            for (double d = full; d >= MIN_CAM_DISTANCE; d -= 0.75) {
                Location test = aim.clone().add(unit.clone().multiply(d));
                if (isCameraCellFree(w, test) && firstBlocker(aim, test) == null) {
                    return test;
                }
            }
            return null;
        }

        private void tick() {
            if (!active) return;
            ticks++;
            if (!cam.isOnline()) {
                cancel("camera_offline");
                return;
            }
            if (subject == null || !subject.isOnline()) {
                subjectLost++;
                return;
            }
            Location sLoc = subject.getLocation();
            if (subjectPrev != null && sLoc.getWorld().equals(subjectPrev.getWorld())) {
                Vector raw = sLoc.toVector().subtract(subjectPrev.toVector());
                if (raw.length() > TELEPORT_DELTA) {
                    // A recovery teleport is not motion: leading on it aims the rig into terrain.
                    subjectVel = new Vector();
                } else {
                    // Low-pass the velocity estimate; raw per-tick deltas are far too noisy to lead on.
                    subjectVel = subjectVel.multiply(0.75).add(raw.multiply(0.25));
                    if (subjectVel.length() > MAX_SUBJECT_VEL) {
                        subjectVel = subjectVel.normalize().multiply(MAX_SUBJECT_VEL);
                    }
                }
            }
            subjectPrev = sLoc.clone();

            Pose target = resolveTarget();
            if (target.wasOccluded) occlusionEvents++;
            if (target.wasRepositioned) repositionEvents++;

            // Fast during a deliberate transition, then a slow lag so tracking never feels rigid.
            double alpha;
            if (transitionTicksLeft > 0) {
                double t = 1.0 - (double) transitionTicksLeft / Math.max(1, transitionTicks);
                alpha = 0.06 + easeInOut(t) * 0.22;
                transitionTicksLeft--;
            } else {
                alpha = 0.10;
            }

            if (camPos == null) camPos = cam.getLocation().clone();
            double gap = Math.sqrt(Math.pow(target.x - camPos.getX(), 2)
                    + Math.pow(target.y - camPos.getY(), 2)
                    + Math.pow(target.z - camPos.getZ(), 2));
            boolean cut = gap > CAM_CUT_DISTANCE || !cam.getWorld().equals(subject.getWorld());
            if (cut) {
                // Hard cut: be on the shot now instead of flying there for half a minute.
                camPos = new Location(sLoc.getWorld(), target.x, target.y, target.z);
                lookPos = new Location(sLoc.getWorld(), target.lookX, target.lookY, target.lookZ);
                cuts++;
                transitionTicksLeft = 0;
            } else {
                camPos.setX(camPos.getX() + (target.x - camPos.getX()) * alpha);
                camPos.setY(camPos.getY() + (target.y - camPos.getY()) * alpha);
                camPos.setZ(camPos.getZ() + (target.z - camPos.getZ()) * alpha);
            }

            if (lookPos == null) lookPos = new Location(sLoc.getWorld(), target.lookX, target.lookY, target.lookZ);
            if (!cut) {
                lookPos.setX(lookPos.getX() + (target.lookX - lookPos.getX()) * 0.22);
                lookPos.setY(lookPos.getY() + (target.lookY - lookPos.getY()) * 0.22);
                lookPos.setZ(lookPos.getZ() + (target.lookZ - lookPos.getZ()) * 0.22);
            }

            World w = sLoc.getWorld();
            Location place = new Location(w, camPos.getX(), camPos.getY(), camPos.getZ());
            if (!isCameraCellFree(w, place)) {
                // Never let the eased path drift inside a wall mid-transition.
                for (double lift = 0.5; lift <= 4.0; lift += 0.5) {
                    Location up = place.clone().add(0, lift, 0);
                    if (isCameraCellFree(w, up)) {
                        place = up;
                        camPos.setY(up.getY());
                        repositionEvents++;
                        break;
                    }
                }
            }
            Vector dir = new Vector(lookPos.getX() - place.getX(),
                    lookPos.getY() - place.getY(),
                    lookPos.getZ() - place.getZ());
            if (dir.lengthSquared() > 1e-6) place.setDirection(dir);
            if (!cut) {
                // Rate-limit the pan as well; snapping the head is as ugly as snapping the body.
                place.setYaw(approachAngle(cam.getLocation().getYaw(), place.getYaw(), 9.0));
                place.setPitch(approachAngle(cam.getLocation().getPitch(), place.getPitch(), 6.0));
            }

            lastDistance = place.distance(sLoc);
            cam.teleport(place);
        }
    }

    private static double easeInOut(double t) {
        double c = clamp(t, 0, 1);
        return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
    }

    /** True when a camera can sit in this cell without clipping into geometry. */
    private static boolean isCameraCellFree(World w, Location loc) {
        int x = loc.getBlockX();
        int y = loc.getBlockY();
        int z = loc.getBlockZ();
        if (y <= w.getMinHeight() + 1 || y >= w.getMaxHeight() - 1) return false;
        if (w.getBlockAt(x, y, z).getType().isSolid()) return false;
        return !w.getBlockAt(x, y + 1, z).getType().isSolid();
    }

    /** First solid block between two points, or null when the line is clear. */
    private static Block firstBlocker(Location from, Location to) {
        World w = from.getWorld();
        if (w == null || to.getWorld() == null || !w.equals(to.getWorld())) return null;
        Vector dir = to.toVector().subtract(from.toVector());
        double len = dir.length();
        if (len < 1e-4) return null;
        RayTraceResult hit = w.rayTraceBlocks(from, dir.multiply(1.0 / len), len,
                FluidCollisionMode.NEVER, true);
        return hit == null ? null : hit.getHitBlock();
    }

    // ---------------------------------------------------------------- helpers

    private static float approachAngle(float from, float to, double maxStep) {
        double delta = wrapDegrees(to - from);
        if (Math.abs(delta) <= maxStep) return to;
        return (float) (from + Math.signum(delta) * maxStep);
    }

    private static double wrapDegrees(double d) {
        double v = d % 360.0;
        if (v >= 180.0) v -= 360.0;
        if (v < -180.0) v += 360.0;
        return v;
    }

    private static double clamp(double v, double lo, double hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    private static double sq(double v) {
        return v * v;
    }

    private static double horizDist(Location a, Location b) {
        double dx = a.getX() - b.getX();
        double dz = a.getZ() - b.getZ();
        return Math.sqrt(dx * dx + dz * dz);
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static String quote(String v) {
        return '"' + (v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"")) + '"';
    }

    private static String fmt(Location loc) {
        String w = loc.getWorld() != null ? loc.getWorld().getName() : "?";
        return w + ":" + loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ();
    }

    private static boolean json(CommandSender sender, boolean success, String action, String target,
                                long t0, String reason, String dataObj) {
        StringBuilder sb = new StringBuilder(160);
        sb.append("{\"success\":").append(success)
                .append(",\"action\":").append(quote(action))
                .append(",\"target\":").append(target == null ? "null" : quote(target))
                .append(",\"duration_ms\":").append(System.currentTimeMillis() - t0)
                .append(",\"reason\":").append(reason == null ? "null" : quote(reason))
                .append(",\"data\":{");
        if (dataObj != null && !dataObj.isEmpty()) sb.append(dataObj);
        sb.append("}}");
        sender.sendMessage("TEST-RESULT json=" + sb);
        return true;
    }
}

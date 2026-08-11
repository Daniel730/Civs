package org.civs.itest.harness;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Locale;
import java.util.stream.Collectors;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * Read-only RPGServer observation via reflection (no compile-time dependency on civs-quests).
 * If RPGServer is absent or the API shape changes, commands fail explicitly — never fake success.
 */
final class RpgBridge {

    private RpgBridge() {}

    static boolean handle(CommandSender sender, String[] a) {
        if (a.length < 2) {
            return err(sender, "usage: /test rpg <ping|observe|abandon|accept|quest_detail|next_quest|pois> ...");
        }
        String sub = a[1].toLowerCase(Locale.ROOT);
        return switch (sub) {
            case "ping" -> ping(sender);
            case "observe" -> {
                if (a.length < 3) yield err(sender, "usage: /test rpg observe <player>");
                yield observe(sender, a[2]);
            }
            case "abandon" -> {
                if (a.length < 4) yield err(sender, "usage: /test rpg abandon <player> <questId>");
                yield abandon(sender, a[2], a[3]);
            }
            case "accept" -> {
                if (a.length < 4) yield err(sender, "usage: /test rpg accept <player> <questId>");
                yield accept(sender, a[2], a[3]);
            }
            case "quest_detail" -> {
                if (a.length < 4) yield err(sender, "usage: /test rpg quest_detail <player> <questId>");
                yield questDetail(sender, a[2], a[3]);
            }
            case "next_quest" -> {
                if (a.length < 3) yield err(sender, "usage: /test rpg next_quest <player>");
                yield nextQuest(sender, a[2]);
            }
            case "pois" -> {
                if (a.length < 3) yield err(sender, "usage: /test rpg pois <player> [radius]");
                double radius = a.length >= 4 ? Double.parseDouble(a[3]) : 256.0;
                yield pois(sender, a[2], radius);
            }
            default -> err(sender, "unknown rpg subcommand: " + sub);
        };
    }

    private static boolean ping(CommandSender sender) {
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        boolean present = rpg != null && rpg.isEnabled();
        sender.sendMessage("TEST-RESULT json={\"success\":true,\"action\":\"rpg_ping\",\"target\":null,\"duration_ms\":0,\"reason\":null,\"data\":{\"present\":"
                + present + (present ? ",\"version\":\"" + escape(rpg.getDescription().getVersion()) + "\"" : "")
                + "}}");
        return true;
    }

    private static boolean observe(CommandSender sender, String playerName) {
        long t0 = System.currentTimeMillis();
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_observe", playerName, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_observe", playerName, t0, "player_offline");
        }
        try {
            Method getProfileManager = rpg.getClass().getMethod("getProfileManager");
            Object profileManager = getProfileManager.invoke(rpg);
            Method getOrCreate = profileManager.getClass().getMethod("getOrCreate", Player.class);
            Object profile = getOrCreate.invoke(profileManager, player);

            String archetype = str(invoke(profile, "getArchetype"));
            String tracked = str(invoke(profile, "getTrackedQuestId"));
            String active = joinIds(invoke(profile, "getActiveQuestIds"));
            String completed = joinIds(invoke(profile, "getCompletedQuestIds"));
            int rebirth = ((Number) invoke(profile, "getRebirthCount")).intValue();
            int essence = ((Number) invoke(profile, "getPathEssence")).intValue();

            String data = "\"archetype\":" + jsonStr(archetype)
                    + ",\"tracked_quest\":" + jsonStr(tracked)
                    + ",\"active_quests\":" + active
                    + ",\"completed_quests\":" + completed
                    + ",\"rebirth_count\":" + rebirth
                    + ",\"path_essence\":" + essence
                    + ",\"rpg_version\":" + jsonStr(rpg.getDescription().getVersion());
            sender.sendMessage("TEST-RESULT json={\"success\":true,\"action\":\"rpg_observe\",\"target\":"
                    + jsonStr(playerName) + ",\"duration_ms\":" + (System.currentTimeMillis() - t0)
                    + ",\"reason\":null,\"data\":{" + data + "}}");
            return true;
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_observe", playerName, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    private static Object invoke(Object target, String method) throws ReflectiveOperationException {
        Method m = target.getClass().getMethod(method);
        return m.invoke(target);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    @SuppressWarnings("unchecked")
    private static String joinIds(Object maybeCollection) {
        if (!(maybeCollection instanceof Collection<?> col)) {
            return "[]";
        }
        return ((Collection<Object>) col).stream()
                .map(o -> jsonStr(String.valueOf(o)))
                .collect(Collectors.joining(",", "[", "]"));
    }

    /**
     * Calls {@code QuestManager.acceptQuest} and returns the real {@code QuestAcceptResult}
     * name — {@code performCommand} alone is insufficient because it returns true even when
     * accept fails (LOCKED / MAX_ACTIVE / …).
     */
    private static boolean accept(CommandSender sender, String playerName, String questId) {
        long t0 = System.currentTimeMillis();
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_accept", questId, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_accept", questId, t0, "player_offline");
        }
        try {
            Object questManager = rpg.getClass().getMethod("getQuestManager").invoke(rpg);
            Method acceptQuest = questManager.getClass().getMethod("acceptQuest", Player.class, String.class);
            Object result = acceptQuest.invoke(questManager, player, questId);
            String resultName = result == null ? "null" : String.valueOf(result);
            boolean ok = "SUCCESS".equals(resultName);
            return json(sender, ok, "rpg_accept", questId, System.currentTimeMillis() - t0,
                    ok ? null : resultName,
                    "\"player\":" + jsonStr(playerName) + ",\"result\":" + jsonStr(resultName));
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_accept", questId, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    /**
     * Quest definition + per-player progress for AI planning (objectives, rewards, status).
     * Reflects {@code QuestManager.getQuest} / {@code getQuestProgress} / objective getters.
     */
    private static boolean questDetail(CommandSender sender, String playerName, String questId) {
        long t0 = System.currentTimeMillis();
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_quest_detail", questId, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_quest_detail", questId, t0, "player_offline");
        }
        try {
            Object profileManager = rpg.getClass().getMethod("getProfileManager").invoke(rpg);
            Object profile = profileManager.getClass().getMethod("getOrCreate", Player.class)
                    .invoke(profileManager, player);
            Object questManager = rpg.getClass().getMethod("getQuestManager").invoke(rpg);
            Object quest = questManager.getClass().getMethod("getQuest", String.class)
                    .invoke(questManager, questId);
            if (quest == null) {
                return failJson(sender, "rpg_quest_detail", questId, t0, "quest_not_found");
            }

            String status = "UNKNOWN";
            try {
                Object st = questManager.getClass()
                        .getMethod("getQuestStatus", Player.class, profile.getClass(), quest.getClass())
                        .invoke(questManager, player, profile, quest);
                status = st == null ? "null" : String.valueOf(st);
            } catch (ReflectiveOperationException ignored) {
                try {
                    Object st = questManager.getClass()
                            .getMethod("getQuestStatus", profile.getClass(), quest.getClass())
                            .invoke(questManager, profile, quest);
                    status = st == null ? "null" : String.valueOf(st);
                } catch (ReflectiveOperationException ignored2) {
                    status = "UNKNOWN";
                }
            }

            int progressDone = 0;
            int progressTotal = 0;
            try {
                Object progress = questManager.getClass()
                        .getMethod("getQuestProgress", profile.getClass(), quest.getClass())
                        .invoke(questManager, profile, quest);
                progressDone = ((Number) progress.getClass().getMethod("completed").invoke(progress)).intValue();
                progressTotal = ((Number) progress.getClass().getMethod("total").invoke(progress)).intValue();
            } catch (ReflectiveOperationException | ClassCastException ignored) {
                // leave zeros
            }

            @SuppressWarnings("unchecked")
            Collection<Object> objectives = (Collection<Object>) invoke(quest, "getObjectives");
            StringBuilder objJson = new StringBuilder("[");
            boolean first = true;
            if (objectives != null) {
                for (Object objective : objectives) {
                    if (!first) objJson.append(',');
                    first = false;
                    String oid = str(invoke(objective, "getId"));
                    String typeId = str(invoke(objective, "getTypeId"));
                    String desc = str(invoke(objective, "getDescription"));
                    String block = str(invoke(objective, "getBlock"));
                    String mob = str(invoke(objective, "getMob"));
                    String region = str(invoke(objective, "getRegion"));
                    int amount = 0;
                    try {
                        amount = ((Number) invoke(objective, "getAmount")).intValue();
                    } catch (ClassCastException | NullPointerException ignored) {
                        amount = 0;
                    }
                    int cur = 0;
                    boolean done = false;
                    try {
                        cur = ((Number) profile.getClass()
                                .getMethod("getObjectiveProgress", String.class, String.class)
                                .invoke(profile, questId, oid)).intValue();
                        done = Boolean.TRUE.equals(profile.getClass()
                                .getMethod("isObjectiveComplete", String.class, String.class)
                                .invoke(profile, questId, oid));
                    } catch (ReflectiveOperationException ignored) {
                        // leave defaults
                    }
                    objJson.append('{')
                            .append("\"id\":").append(jsonStr(oid))
                            .append(",\"typeId\":").append(jsonStr(typeId))
                            .append(",\"description\":").append(jsonStr(desc))
                            .append(",\"block\":").append(jsonStr(block))
                            .append(",\"mob\":").append(jsonStr(mob))
                            .append(",\"region\":").append(jsonStr(region))
                            .append(",\"amount\":").append(amount)
                            .append(",\"progress\":").append(cur)
                            .append(",\"complete\":").append(done)
                            .append('}');
                }
            }
            objJson.append(']');

            Object rewards = invoke(quest, "getRewards");
            double money = 0;
            if (rewards != null) {
                try {
                    money = ((Number) invoke(rewards, "getMoney")).doubleValue();
                } catch (ClassCastException | NullPointerException ignored) {
                    money = 0;
                }
            }

            String data = "\"id\":" + jsonStr(questId)
                    + ",\"name\":" + jsonStr(str(invoke(quest, "getName")))
                    + ",\"archetype\":" + jsonStr(str(invoke(quest, "getArchetype")))
                    + ",\"description\":" + jsonStr(str(invoke(quest, "getDescription")))
                    + ",\"tier\":" + safeInt(invoke(quest, "getTier"))
                    + ",\"status\":" + jsonStr(status)
                    + ",\"progress_completed\":" + progressDone
                    + ",\"progress_total\":" + progressTotal
                    + ",\"objectives\":" + objJson
                    + ",\"rewards\":{\"money\":" + money + "}"
                    + ",\"player\":" + jsonStr(playerName);
            return json(sender, true, "rpg_quest_detail", questId, System.currentTimeMillis() - t0, null, data);
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_quest_detail", questId, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    /**
     * Next available story quest for the player's archetype via
     * {@code QuestManager.findNextAvailableQuest}.
     */
    private static boolean nextQuest(CommandSender sender, String playerName) {
        long t0 = System.currentTimeMillis();
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_next_quest", playerName, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_next_quest", playerName, t0, "player_offline");
        }
        try {
            Object profileManager = rpg.getClass().getMethod("getProfileManager").invoke(rpg);
            Object profile = profileManager.getClass().getMethod("getOrCreate", Player.class)
                    .invoke(profileManager, player);
            Object questManager = rpg.getClass().getMethod("getQuestManager").invoke(rpg);
            Object optional = questManager.getClass()
                    .getMethod("findNextAvailableQuest", Player.class, profile.getClass())
                    .invoke(questManager, player, profile);
            boolean present = Boolean.TRUE.equals(optional.getClass().getMethod("isPresent").invoke(optional));
            if (!present) {
                return json(sender, true, "rpg_next_quest", playerName, System.currentTimeMillis() - t0, null,
                        "\"quest\":null,\"player\":" + jsonStr(playerName));
            }
            Object quest = optional.getClass().getMethod("get").invoke(optional);
            String qid = str(invoke(quest, "getId"));
            String data = "\"player\":" + jsonStr(playerName)
                    + ",\"quest\":{"
                    + "\"id\":" + jsonStr(qid)
                    + ",\"name\":" + jsonStr(str(invoke(quest, "getName")))
                    + ",\"archetype\":" + jsonStr(str(invoke(quest, "getArchetype")))
                    + ",\"description\":" + jsonStr(str(invoke(quest, "getDescription")))
                    + "}";
            return json(sender, true, "rpg_next_quest", qid, System.currentTimeMillis() - t0, null, data);
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_next_quest", playerName, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    /**
     * RPG DiscoveryRegistry POIs near the player (authoritative coordinates from pois.yml).
     */
    private static boolean pois(CommandSender sender, String playerName, double radius) {
        long t0 = System.currentTimeMillis();
        if (radius < 1) radius = 1;
        if (radius > 2048) radius = 2048;
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_pois", playerName, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_pois", playerName, t0, "player_offline");
        }
        try {
            Object discovery = rpg.getClass().getMethod("getDiscoveryService").invoke(rpg);
            Object registry = discovery.getClass().getMethod("getRegistry").invoke(discovery);
            @SuppressWarnings("unchecked")
            Collection<Object> all = (Collection<Object>) registry.getClass().getMethod("getAllPois").invoke(registry);
            Location origin = player.getLocation();
            StringBuilder arr = new StringBuilder("[");
            boolean first = true;
            int count = 0;
            for (Object poi : all) {
                String worldName = str(invoke(poi, "getWorldName"));
                if (origin.getWorld() == null || worldName == null
                        || !origin.getWorld().getName().equalsIgnoreCase(worldName)) {
                    continue;
                }
                double px = ((Number) invoke(poi, "getX")).doubleValue();
                double py = ((Number) invoke(poi, "getY")).doubleValue();
                double pz = ((Number) invoke(poi, "getZ")).doubleValue();
                double dx = origin.getX() - px;
                double dy = origin.getY() - py;
                double dz = origin.getZ() - pz;
                double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > radius) continue;
                if (!first) arr.append(',');
                first = false;
                arr.append('{')
                        .append("\"id\":").append(jsonStr(str(invoke(poi, "getId"))))
                        .append(",\"name\":").append(jsonStr(str(invoke(poi, "getName"))))
                        .append(",\"world\":").append(jsonStr(worldName))
                        .append(",\"x\":").append(px)
                        .append(",\"y\":").append(py)
                        .append(",\"z\":").append(pz)
                        .append(",\"radius\":").append(((Number) invoke(poi, "getRadius")).doubleValue())
                        .append(",\"distance\":").append(Math.round(dist * 100.0) / 100.0)
                        .append('}');
                if (++count >= 64) break;
            }
            arr.append(']');
            String data = "\"player\":" + jsonStr(playerName)
                    + ",\"radius\":" + radius
                    + ",\"count\":" + count
                    + ",\"pois\":" + arr;
            return json(sender, true, "rpg_pois", playerName, System.currentTimeMillis() - t0, null, data);
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_pois", playerName, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    private static int safeInt(Object o) {
        if (o instanceof Number n) {
            return n.intValue();
        }
        return 0;
    }

    /**
     * Calls RPGServer {@code QuestManager.abandonQuest} via reflection so QA can free
     * max-active slots. This is teardown/setup, not a fake accept path.
     */
    private static boolean abandon(CommandSender sender, String playerName, String questId) {
        long t0 = System.currentTimeMillis();
        Plugin rpg = Bukkit.getPluginManager().getPlugin("RPGServer");
        if (rpg == null || !rpg.isEnabled()) {
            return failJson(sender, "rpg_abandon", questId, t0, "rpg_absent");
        }
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null || !player.isOnline()) {
            return failJson(sender, "rpg_abandon", questId, t0, "player_offline");
        }
        try {
            Object profileManager = rpg.getClass().getMethod("getProfileManager").invoke(rpg);
            Object profile = profileManager.getClass().getMethod("getOrCreate", Player.class)
                    .invoke(profileManager, player);
            Object questManager = rpg.getClass().getMethod("getQuestManager").invoke(rpg);
            Object quest = questManager.getClass().getMethod("getQuest", String.class)
                    .invoke(questManager, questId);
            if (quest == null) {
                return failJson(sender, "rpg_abandon", questId, t0, "quest_not_found");
            }
            Method abandon = null;
            for (Method m : questManager.getClass().getMethods()) {
                if ("abandonQuest".equals(m.getName()) && m.getParameterCount() == 3) {
                    abandon = m;
                    break;
                }
            }
            if (abandon == null) {
                return failJson(sender, "rpg_abandon", questId, t0, "method_missing");
            }
            boolean ok = Boolean.TRUE.equals(abandon.invoke(questManager, player, profile, quest));
            return json(sender, ok, "rpg_abandon", questId, System.currentTimeMillis() - t0,
                    ok ? null : "abandon_rejected",
                    "\"player\":" + jsonStr(playerName));
        } catch (ReflectiveOperationException | ClassCastException | NullPointerException e) {
            return failJson(sender, "rpg_abandon", questId, t0,
                    e.getClass().getSimpleName() + ":" + e.getMessage());
        }
    }

    private static boolean json(CommandSender sender, boolean success, String action, String target,
                                long durationMs, String reason, String dataObj) {
        StringBuilder sb = new StringBuilder(96);
        sb.append("{\"success\":").append(success)
                .append(",\"action\":").append(jsonStr(action))
                .append(",\"target\":").append(target == null ? "null" : jsonStr(target))
                .append(",\"duration_ms\":").append(durationMs)
                .append(",\"reason\":").append(reason == null ? "null" : jsonStr(reason))
                .append(",\"data\":{");
        if (dataObj != null) sb.append(dataObj);
        sb.append("}}");
        sender.sendMessage("TEST-RESULT json=" + sb);
        return true;
    }

    private static boolean failJson(CommandSender sender, String action, String target, long t0, String reason) {
        sender.sendMessage("TEST-RESULT json={\"success\":false,\"action\":" + jsonStr(action)
                + ",\"target\":" + jsonStr(target)
                + ",\"duration_ms\":" + (System.currentTimeMillis() - t0)
                + ",\"reason\":" + jsonStr(reason) + ",\"data\":{}}");
        return true;
    }

    private static boolean err(CommandSender sender, String msg) {
        sender.sendMessage("TEST-ERROR " + msg);
        return true;
    }

    private static String jsonStr(String v) {
        if (v == null) return "null";
        return '"' + escape(v) + '"';
    }

    private static String escape(String v) {
        return v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}

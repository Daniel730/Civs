package org.civs.itest.harness;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Locale;
import java.util.stream.Collectors;

import org.bukkit.Bukkit;
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
            return err(sender, "usage: /test rpg <ping|observe> [player]");
        }
        String sub = a[1].toLowerCase(Locale.ROOT);
        return switch (sub) {
            case "ping" -> ping(sender);
            case "observe" -> {
                if (a.length < 3) yield err(sender, "usage: /test rpg observe <player>");
                yield observe(sender, a[2]);
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

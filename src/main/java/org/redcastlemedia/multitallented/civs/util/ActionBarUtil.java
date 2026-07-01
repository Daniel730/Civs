package org.redcastlemedia.multitallented.civs.util;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.entity.Player;

public final class ActionBarUtil {
    private ActionBarUtil() {

    }

    public static void sendActionBar(Player player, String message) {
        if (!player.isOnline()) {
            return; // Player may have logged out
        }
        Component component = LegacyComponentSerializer.legacySection().deserialize(message);
        player.sendActionBar(component);
    }
}

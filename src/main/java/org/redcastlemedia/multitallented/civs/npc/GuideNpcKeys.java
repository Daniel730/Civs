package org.redcastlemedia.multitallented.civs.npc;

import org.bukkit.NamespacedKey;
import org.bukkit.entity.LivingEntity;
import org.bukkit.persistence.PersistentDataType;
import org.redcastlemedia.multitallented.civs.Civs;

public final class GuideNpcKeys {
    private static NamespacedKey guideIdKey;

    private GuideNpcKeys() {
    }

    public static void init(Civs plugin) {
        guideIdKey = new NamespacedKey(plugin, "guide_npc_id");
    }

    public static NamespacedKey guideId() {
        return guideIdKey;
    }

    public static String readGuideId(LivingEntity entity) {
        if (guideIdKey == null || entity == null) {
            return null;
        }
        return entity.getPersistentDataContainer().get(guideIdKey, PersistentDataType.STRING);
    }

    public static void writeGuideId(LivingEntity entity, String guideId) {
        if (guideIdKey == null || entity == null || guideId == null) {
            return;
        }
        entity.getPersistentDataContainer().set(guideIdKey, PersistentDataType.STRING, guideId.toLowerCase());
    }
}

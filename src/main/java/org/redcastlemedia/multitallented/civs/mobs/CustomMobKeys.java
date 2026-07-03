package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.NamespacedKey;
import org.bukkit.entity.LivingEntity;
import org.bukkit.persistence.PersistentDataType;
import org.redcastlemedia.multitallented.civs.Civs;

public final class CustomMobKeys {
    private static NamespacedKey mobIdKey;

    private CustomMobKeys() {
    }

    public static void init(Civs plugin) {
        mobIdKey = new NamespacedKey(plugin, "custom_mob_id");
    }

    public static NamespacedKey mobId() {
        return mobIdKey;
    }

    public static String readMobId(LivingEntity entity) {
        if (mobIdKey == null || entity == null) {
            return null;
        }
        return entity.getPersistentDataContainer().get(mobIdKey, PersistentDataType.STRING);
    }

    public static void writeMobId(LivingEntity entity, String mobId) {
        if (mobIdKey == null || entity == null || mobId == null) {
            return;
        }
        entity.getPersistentDataContainer().set(mobIdKey, PersistentDataType.STRING, mobId.toLowerCase());
    }
}

package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.NamespacedKey;
import org.bukkit.entity.LivingEntity;
import org.bukkit.persistence.PersistentDataType;
import org.redcastlemedia.multitallented.civs.Civs;

import java.util.UUID;

public final class CustomMobKeys {
    private static NamespacedKey mobIdKey;
    private static NamespacedKey questOwnerKey;
    private static NamespacedKey partyRadiusKey;

    private CustomMobKeys() {
    }

    public static void init(Civs plugin) {
        mobIdKey = new NamespacedKey(plugin, "custom_mob_id");
        questOwnerKey = new NamespacedKey(plugin, "quest_owner");
        partyRadiusKey = new NamespacedKey(plugin, "quest_party_radius");
    }

    public static NamespacedKey mobId() {
        return mobIdKey;
    }

    public static NamespacedKey questOwner() {
        return questOwnerKey;
    }

    public static NamespacedKey partyRadius() {
        return partyRadiusKey;
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

    public static void writeQuestOwner(LivingEntity entity, UUID owner) {
        if (questOwnerKey == null || entity == null || owner == null) {
            return;
        }
        entity.getPersistentDataContainer().set(questOwnerKey, PersistentDataType.STRING, owner.toString());
    }

    public static UUID readQuestOwner(LivingEntity entity) {
        if (questOwnerKey == null || entity == null) {
            return null;
        }
        String raw = entity.getPersistentDataContainer().get(questOwnerKey, PersistentDataType.STRING);
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    public static void writePartyRadius(LivingEntity entity, double partyRadius) {
        if (partyRadiusKey == null || entity == null || partyRadius <= 0) {
            return;
        }
        entity.getPersistentDataContainer().set(partyRadiusKey, PersistentDataType.DOUBLE, partyRadius);
    }

    public static double readPartyRadius(LivingEntity entity) {
        if (partyRadiusKey == null || entity == null) {
            return 0;
        }
        Double radius = entity.getPersistentDataContainer().get(partyRadiusKey, PersistentDataType.DOUBLE);
        return radius == null ? 0 : radius;
    }
}

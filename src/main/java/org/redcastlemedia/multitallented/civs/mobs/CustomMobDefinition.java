package org.redcastlemedia.multitallented.civs.mobs;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.EntityType;

import lombok.Getter;

@Getter
public class CustomMobDefinition {
    private final String id;
    private final String display;
    private final EntityType entityType;
    private final double health;
    private final double damage;
    private final int despawnSeconds;
    private final List<CustomMobDrop> drops;

    public CustomMobDefinition(String id, String display, EntityType entityType,
            double health, double damage, int despawnSeconds, List<CustomMobDrop> drops) {
        this.id = id;
        this.display = display;
        this.entityType = entityType;
        this.health = health;
        this.damage = damage;
        this.despawnSeconds = despawnSeconds;
        this.drops = Collections.unmodifiableList(new ArrayList<>(drops));
    }

    public static CustomMobDefinition fromConfig(FileConfiguration config, String fileId) {
        if (!config.getBoolean("enabled", true)) {
            return null;
        }
        String id = config.getString("id", fileId).toLowerCase();
        String display = config.getString("display", id);
        EntityType entityType = EntityType.valueOf(config.getString("type", "ZOMBIE").toUpperCase());
        double health = config.getDouble("health", 20.0);
        double damage = config.getDouble("damage", 2.0);
        int despawnSeconds = config.getInt("despawn-seconds", 0);
        return new CustomMobDefinition(id, display, entityType, health, damage, despawnSeconds, parseDrops(config));
    }

    static List<CustomMobDrop> parseDrops(FileConfiguration config) {
        List<CustomMobDrop> drops = new ArrayList<>();
        if (config.isList("drops")) {
            for (Map<?, ?> entry : config.getMapList("drops")) {
                CustomMobDrop drop = parseDropMap(entry);
                if (drop != null) {
                    drops.add(drop);
                }
            }
        } else if (config.isConfigurationSection("drops")) {
            for (String key : config.getConfigurationSection("drops").getKeys(false)) {
                CustomMobDrop drop = parseDropSection(config.getConfigurationSection("drops." + key));
                if (drop != null) {
                    drops.add(drop);
                }
            }
        }
        return drops;
    }

    private static CustomMobDrop parseDropMap(Map<?, ?> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        Object materialValue = map.containsKey("material") ? map.get("material") : map.get("item");
        return parseDropValues(materialValue, map.get("amount"), map.get("min-amount"), map.get("max-amount"),
                map.get("chance"));
    }

    private static CustomMobDrop parseDropSection(ConfigurationSection section) {
        if (section == null) {
            return null;
        }
        return parseDropValues(section.getString("material", section.getString("item", "")),
                section.get("amount"), section.get("min-amount"), section.get("max-amount"), section.get("chance"));
    }

    private static CustomMobDrop parseDropValues(Object materialValue, Object amountValue, Object minAmountValue,
            Object maxAmountValue, Object chanceValue) {
        if (materialValue == null) {
            return null;
        }
        String materialName = String.valueOf(materialValue);
        if (materialName.isEmpty()) {
            return null;
        }
        Material material;
        try {
            material = Material.valueOf(materialName.toUpperCase());
        } catch (IllegalArgumentException ex) {
            return null;
        }
        if (!material.isItem()) {
            return null;
        }
        int amount = toInt(amountValue, 1);
        int minAmount = minAmountValue == null ? amount : toInt(minAmountValue, amount);
        int maxAmount = maxAmountValue == null ? amount : toInt(maxAmountValue, amount);
        if (minAmount > maxAmount) {
            int swap = minAmount;
            minAmount = maxAmount;
            maxAmount = swap;
        }
        double chance = chanceValue == null ? 1.0 : toDouble(chanceValue, 1.0);
        return new CustomMobDrop(material, minAmount, maxAmount, chance);
    }

    private static int toInt(Object value, int fallback) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }

    private static double toDouble(Object value, double fallback) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException ex) {
            return fallback;
        }
    }
}

package org.redcastlemedia.multitallented.civs.stats;

import java.util.Locale;

public enum TerritorialStat {
    ATTACK_DAMAGE,
    DAMAGE_REDUCTION,
    SHOP_DISCOUNT,
    BUILD_SPEED,
    SIEGE_DAMAGE;

    public static TerritorialStat fromKey(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        try {
            return valueOf(key.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    public String key() {
        return name().toLowerCase(Locale.ROOT);
    }
}

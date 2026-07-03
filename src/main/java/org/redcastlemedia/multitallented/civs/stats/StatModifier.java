package org.redcastlemedia.multitallented.civs.stats;

import lombok.Getter;

/**
 * Territorial stat modifier. RPG perks should use ids {@code rpg_<perk_id>}.
 */
@Getter
public final class StatModifier {
    private final String id;
    private final TerritorialStat stat;
    private final double value;
    private final StatOperation operation;

    public StatModifier(String id, TerritorialStat stat, double value, StatOperation operation) {
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("modifier id is required");
        }
        if (stat == null) {
            throw new IllegalArgumentException("stat is required");
        }
        if (operation == null) {
            throw new IllegalArgumentException("operation is required");
        }
        this.id = id;
        this.stat = stat;
        this.value = value;
        this.operation = operation;
    }
}

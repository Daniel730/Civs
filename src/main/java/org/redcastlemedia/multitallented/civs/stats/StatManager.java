package org.redcastlemedia.multitallented.civs.stats;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.redcastlemedia.multitallented.civs.CivsSingleton;

@CivsSingleton
public class StatManager {
    private static StatManager instance;

    private final Map<UUID, Map<String, StatModifier>> playerModifiers = new HashMap<>();

    public static synchronized StatManager getInstance() {
        if (instance == null) {
            instance = new StatManager();
        }
        return instance;
    }

    public void addModifier(UUID playerId, StatModifier modifier) {
        if (playerId == null || modifier == null) {
            return;
        }
        playerModifiers
                .computeIfAbsent(playerId, ignored -> new HashMap<>())
                .put(modifier.getId(), modifier);
    }

    public boolean removeModifier(UUID playerId, String modifierId) {
        if (playerId == null || modifierId == null || modifierId.isEmpty()) {
            return false;
        }
        Map<String, StatModifier> modifiers = playerModifiers.get(playerId);
        if (modifiers == null) {
            return false;
        }
        boolean removed = modifiers.remove(modifierId) != null;
        if (modifiers.isEmpty()) {
            playerModifiers.remove(playerId);
        }
        return removed;
    }

    public boolean hasModifier(UUID playerId, String modifierId) {
        if (playerId == null || modifierId == null || modifierId.isEmpty()) {
            return false;
        }
        Map<String, StatModifier> modifiers = playerModifiers.get(playerId);
        return modifiers != null && modifiers.containsKey(modifierId);
    }

    public void clearPlayer(UUID playerId) {
        if (playerId == null) {
            return;
        }
        playerModifiers.remove(playerId);
    }

    public Collection<StatModifier> getModifiers(UUID playerId) {
        if (playerId == null) {
            return Collections.emptyList();
        }
        Map<String, StatModifier> modifiers = playerModifiers.get(playerId);
        if (modifiers == null || modifiers.isEmpty()) {
            return Collections.emptyList();
        }
        return Collections.unmodifiableCollection(modifiers.values());
    }

    public StatTotals getStatTotals(UUID playerId, TerritorialStat stat) {
        if (playerId == null || stat == null) {
            return new StatTotals(0, 1);
        }
        double addTotal = 0;
        double multiplyTotal = 1;
        Map<String, StatModifier> modifiers = playerModifiers.get(playerId);
        if (modifiers == null) {
            return new StatTotals(0, 1);
        }
        for (StatModifier modifier : modifiers.values()) {
            if (modifier.getStat() != stat) {
                continue;
            }
            if (modifier.getOperation() == StatOperation.ADD) {
                addTotal += modifier.getValue();
            } else {
                multiplyTotal *= modifier.getValue();
            }
        }
        return new StatTotals(addTotal, multiplyTotal);
    }

    public double getStatValue(UUID playerId, TerritorialStat stat) {
        return getStatTotals(playerId, stat).getAddTotal();
    }
}

package org.redcastlemedia.multitallented.civs.mobs;

import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/**
 * Resolves which player receives quest credit when a quest-owned custom mob dies.
 */
public final class QuestMobKillCredit {

    private QuestMobKillCredit() {
    }

    /**
     * @return quest owner when the killer is the owner or a nearby ally within {@code partyRadius};
     *         the killer for non-quest mobs; null when credit cannot be awarded
     */
    public static Player resolve(Player killer, UUID questOwner, double partyRadius) {
        if (questOwner == null) {
            return killer;
        }
        if (killer == null) {
            return null;
        }
        if (questOwner.equals(killer.getUniqueId())) {
            return killer;
        }
        if (partyRadius <= 0) {
            return null;
        }
        Player owner = Bukkit.getPlayer(questOwner);
        if (owner == null || !owner.isOnline()) {
            return null;
        }
        if (!owner.getWorld().equals(killer.getWorld())) {
            return null;
        }
        double radiusSquared = partyRadius * partyRadius;
        if (owner.getLocation().distanceSquared(killer.getLocation()) <= radiusSquared) {
            return owner;
        }
        return null;
    }
}

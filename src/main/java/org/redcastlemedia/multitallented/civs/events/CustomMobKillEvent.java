package org.redcastlemedia.multitallented.civs.events;

import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

import lombok.Getter;

/**
 * Fired when a Civs custom mob (PDC {@code civs:custom_mob_id}) is killed.
 */
public class CustomMobKillEvent extends Event {
    private static final HandlerList HANDLERS = new HandlerList();

    @Getter
    private final String mobId;
    @Getter
    private final Player killer;
    @Getter
    private final Location location;
    /** Quest owner from PDC when mob was spawned via {@code spawnForQuest}; null otherwise. */
    @Getter
    private final UUID questOwner;
    /** Player who should receive quest progress; null when credit cannot be awarded. */
    @Getter
    private final Player creditedPlayer;

    public CustomMobKillEvent(String mobId, Player killer, Location location, UUID questOwner, Player creditedPlayer) {
        this.mobId = mobId;
        this.killer = killer;
        this.location = location == null ? null : location.clone();
        this.questOwner = questOwner;
        this.creditedPlayer = creditedPlayer;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}

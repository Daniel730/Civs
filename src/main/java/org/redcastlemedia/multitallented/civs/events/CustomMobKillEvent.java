package org.redcastlemedia.multitallented.civs.events;

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

    public CustomMobKillEvent(String mobId, Player killer, Location location) {
        this.mobId = mobId;
        this.killer = killer;
        this.location = location == null ? null : location.clone();
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}

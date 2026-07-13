package org.redcastlemedia.multitallented.civs.events;

import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import lombok.Getter;

/**
 * Fired when a player right-clicks a Civs guide NPC.
 */
public class GuideNpcInteractEvent extends Event {
    private static final HandlerList HANDLERS = new HandlerList();

    @Getter
    private final Player player;
    @Getter
    private final String guideId;
    @Getter
    private final String archetype;

    public GuideNpcInteractEvent(Player player, String guideId, String archetype) {
        this.player = player;
        this.guideId = guideId;
        this.archetype = archetype;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}

package org.redcastlemedia.multitallented.civs.events;

import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import lombok.Getter;

/**
 * Fired when a player completes the Civs tutorial CHOOSE step (path selection).
 */
public class TutorialChooseCompleteEvent extends Event {
    private static final HandlerList HANDLERS = new HandlerList();

    @Getter
    private final Player player;
    @Getter
    private final String tutorialPath;

    public TutorialChooseCompleteEvent(Player player, String tutorialPath) {
        this.player = player;
        this.tutorialPath = tutorialPath;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}

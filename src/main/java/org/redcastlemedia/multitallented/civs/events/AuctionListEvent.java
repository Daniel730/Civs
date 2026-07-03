package org.redcastlemedia.multitallented.civs.events;

import java.util.UUID;

import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.inventory.ItemStack;

import lombok.Getter;

/**
 * Fired when a player lists an item on the Civs auction house (BIN).
 */
public class AuctionListEvent extends Event implements Cancellable {
    private static final HandlerList HANDLERS = new HandlerList();

    @Getter
    private final UUID sellerId;
    @Getter
    private final String listingId;
    @Getter
    private final ItemStack item;
    @Getter
    private final double price;
    @Getter
    private final double listingTax;
    private boolean cancelled;

    public AuctionListEvent(UUID sellerId, String listingId, ItemStack item, double price, double listingTax) {
        this.sellerId = sellerId;
        this.listingId = listingId;
        this.item = item;
        this.price = price;
        this.listingTax = listingTax;
    }

    @Override
    public boolean isCancelled() {
        return cancelled;
    }

    @Override
    public void setCancelled(boolean cancelled) {
        this.cancelled = cancelled;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}

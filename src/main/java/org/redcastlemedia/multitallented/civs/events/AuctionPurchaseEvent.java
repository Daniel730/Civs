package org.redcastlemedia.multitallented.civs.events;

import java.util.UUID;

import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.inventory.ItemStack;

import lombok.Getter;

/**
 * Fired when a player purchases a BIN auction listing.
 */
public class AuctionPurchaseEvent extends Event implements Cancellable {
    private static final HandlerList HANDLERS = new HandlerList();

    @Getter
    private final UUID buyerId;
    @Getter
    private final UUID sellerId;
    @Getter
    private final String listingId;
    @Getter
    private final ItemStack item;
    @Getter
    private final double price;
    private boolean cancelled;

    public AuctionPurchaseEvent(UUID buyerId, UUID sellerId, String listingId, ItemStack item, double price) {
        this.buyerId = buyerId;
        this.sellerId = sellerId;
        this.listingId = listingId;
        this.item = item;
        this.price = price;
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

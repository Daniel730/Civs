package org.redcastlemedia.multitallented.civs.auction;

import java.util.UUID;

import org.bukkit.inventory.ItemStack;

import lombok.Getter;
import lombok.Setter;

@Getter @Setter
public class AuctionListing {
    private String id;
    private UUID sellerId;
    private String sellerName;
    private ItemStack item;
    private double price;
    private long listedAt;
    private long expiresAt;

    public boolean isExpired() {
        return System.currentTimeMillis() >= expiresAt;
    }
}

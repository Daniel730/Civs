package org.redcastlemedia.multitallented.civs.auction;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Test;

public class AuctionManagerTest {

    @Test
    public void browseComparatorSortsByPriceAscending() throws Exception {
        AuctionListing cheap = listing("a", 10);
        AuctionListing expensive = listing("b", 50);
        Comparator<AuctionListing> comparator = comparator("price_asc");
        List<AuctionListing> sorted = new ArrayList<>(List.of(expensive, cheap));
        sorted.sort(comparator);
        assertEquals(10.0, sorted.get(0).getPrice(), 0.001);
    }

    @Test
    public void browseComparatorSortsByNameDescending() throws Exception {
        AuctionListing alpha = listing("a", 10);
        alpha.setItem(new ItemStack(Material.APPLE));
        AuctionListing beta = listing("b", 10);
        beta.setItem(new ItemStack(Material.COAL));
        Comparator<AuctionListing> comparator = comparator("name_desc");
        List<AuctionListing> sorted = new java.util.ArrayList<>(List.of(alpha, beta));
        sorted.sort(comparator);
        assertTrue(sorted.get(0).getItem().getType().name().compareTo(
                sorted.get(1).getItem().getType().name()) > 0);
    }

    private static AuctionListing listing(String id, double price) {
        AuctionListing listing = new AuctionListing();
        listing.setId(id);
        listing.setSellerId(UUID.randomUUID());
        listing.setSellerName("seller");
        listing.setItem(new ItemStack(Material.STONE));
        listing.setPrice(price);
        listing.setListedAt(1);
        listing.setExpiresAt(Long.MAX_VALUE);
        return listing;
    }

    private static Comparator<AuctionListing> comparator(String sort) throws Exception {
        Method method = AuctionManager.class.getDeclaredMethod("browseComparator", String.class);
        method.setAccessible(true);
        @SuppressWarnings("unchecked")
        Comparator<AuctionListing> comparator = (Comparator<AuctionListing>) method.invoke(
                AuctionManager.getInstance(), sort);
        return comparator;
    }
}

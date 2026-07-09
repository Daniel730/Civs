package org.redcastlemedia.multitallented.civs.menus.auction;

import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Map;

import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.auction.AuctionListing;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;

import net.milkbowl.vault.economy.Economy;

import static org.mockito.Mockito.mock;

public class AuctionMyListingsMenuTests extends TestUtil {

    private static final String LISTING_ID = "auction-menu-listing-id";

    private Civilian civilian;
    private Economy previousEconomy;
    private boolean previousUseAuctionHouse;

    @Before
    public void setup() throws Exception {
        MenuManager.getInstance().clearOpenMenus();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        previousEconomy = Civs.econ;
        Civs.econ = mock(Economy.class);
        previousUseAuctionHouse = setUseAuctionHouse(true);
        AuctionManager.getInstance().reload();
        putListing(createListing());
    }

    @After
    public void tearDown() throws Exception {
        Civs.econ = previousEconomy;
        setUseAuctionHouse(previousUseAuctionHouse);
        AuctionManager.getInstance().reload();
    }

    @Test
    public void cancelListingShouldRemoveListingFromLoreId() {
        ItemStack clickedItem = new ItemStackImpl(Material.STONE, 1);
        ArrayList<String> lore = new ArrayList<>();
        lore.add("price line");
        lore.add(ChatColor.DARK_GRAY + LISTING_ID);
        clickedItem.getItemMeta().setLore(lore);

        AuctionMyListingsMenu menu = new AuctionMyListingsMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "cancel-listing", clickedItem);

        assertTrue(cancelled);
        assertNull(AuctionManager.getInstance().getListing(LISTING_ID));
    }

    private static AuctionListing createListing() {
        AuctionListing listing = new AuctionListing();
        listing.setId(LISTING_ID);
        listing.setSellerId(player.getUniqueId());
        listing.setSellerName("seller");
        listing.setItem(new ItemStack(Material.STONE));
        listing.setPrice(10);
        listing.setListedAt(System.currentTimeMillis());
        listing.setExpiresAt(Long.MAX_VALUE);
        return listing;
    }

    @SuppressWarnings("unchecked")
    private static void putListing(AuctionListing listing) throws Exception {
        Field field = AuctionManager.class.getDeclaredField("listings");
        field.setAccessible(true);
        Map<String, AuctionListing> listings = (Map<String, AuctionListing>) field.get(AuctionManager.getInstance());
        listings.put(listing.getId(), listing);
    }

    private static boolean setUseAuctionHouse(boolean enabled) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("useAuctionHouse");
        field.setAccessible(true);
        boolean previous = field.getBoolean(ConfigManager.getInstance());
        field.setBoolean(ConfigManager.getInstance(), enabled);
        return previous;
    }
}

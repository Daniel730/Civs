package org.redcastlemedia.multitallented.civs.menus.auction;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.PlayerInventoryImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.auction.AuctionListing;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;

import net.milkbowl.vault.economy.Economy;

public class AuctionBrowseMenuTests extends TestUtil {

    private static final String LISTING_ID = "auction-browse-listing-id";

    private Civilian civilian;
    private Economy previousEconomy;
    private boolean previousUseAuctionHouse;
    private boolean previousAuctionPurchaseFeedback;

    @Before
    public void setup() throws Exception {
        MenuManager.getInstance().clearOpenMenus();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        previousEconomy = Civs.econ;
        Civs.econ = mock(Economy.class);
        previousUseAuctionHouse = setUseAuctionHouse(true);
        previousAuctionPurchaseFeedback = setAuctionPurchaseFeedback(false);
        AuctionManager.getInstance().reload();
        putListing(createListing());
        when(Civs.econ.has(player, 25)).thenReturn(true);
    }

    @After
    public void tearDown() throws Exception {
        Civs.econ = previousEconomy;
        setUseAuctionHouse(previousUseAuctionHouse);
        setAuctionPurchaseFeedback(previousAuctionPurchaseFeedback);
        AuctionManager.getInstance().reload();
    }

    @Test
    public void buyListingShouldPurchaseFromLoreId() {
        ItemStack clickedItem = new ItemStackImpl(Material.STONE, 1);
        ArrayList<String> lore = new ArrayList<>();
        lore.add("price line");
        lore.add(ChatColor.DARK_GRAY + LISTING_ID);
        clickedItem.getItemMeta().setLore(lore);

        AuctionBrowseMenu menu = new AuctionBrowseMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "buy-listing", clickedItem);

        assertTrue(cancelled);
        assertNull(AuctionManager.getInstance().getListing(LISTING_ID));
        verify(Civs.econ).withdrawPlayer(player, 25);
    }

    @Test
    public void sortPriceShouldToggleToDescending() {
        seedBrowseMenuData("price_asc", "");
        AuctionBrowseMenu menu = new AuctionBrowseMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "sort-price", null);

        assertTrue(cancelled);
        assertEquals("price_desc", MenuManager.getData(player.getUniqueId(), "sort"));
    }

    @Test
    public void sortNameShouldToggleToDescending() {
        seedBrowseMenuData("name_asc", "");
        AuctionBrowseMenu menu = new AuctionBrowseMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "sort-name", null);

        assertTrue(cancelled);
        assertEquals("name_desc", MenuManager.getData(player.getUniqueId(), "sort"));
    }

    @Test
    public void filterMaterialShouldUseHeldItemType() {
        PlayerInventoryImpl originalInventory = (PlayerInventoryImpl) player.getInventory();
        try {
            seedBrowseMenuData("price_asc", "");
            ItemStackImpl hand = new ItemStackImpl(Material.STONE, 1);
            PlayerInventoryImpl inventory = org.mockito.Mockito.spy(new PlayerInventoryImpl());
            org.mockito.Mockito.doReturn(hand).when(inventory).getItemInMainHand();
            org.mockito.Mockito.when(player.getInventory()).thenReturn(inventory);
            AuctionBrowseMenu menu = new AuctionBrowseMenu();

            boolean cancelled = menu.doActionAndCancel(civilian, "filter-material", null);

            assertTrue(cancelled);
            assertEquals("STONE", MenuManager.getData(player.getUniqueId(), "filter"));
        } finally {
            org.mockito.Mockito.when(player.getInventory()).thenReturn(originalInventory);
        }
    }

    @Test
    public void clearFilterShouldRemoveActiveFilter() {
        seedBrowseMenuData("price_asc", "STONE");
        AuctionBrowseMenu menu = new AuctionBrowseMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "clear-filter", null);

        assertTrue(cancelled);
        assertEquals("", MenuManager.getData(player.getUniqueId(), "filter"));
    }

    private void seedBrowseMenuData(String sort, String filter) {
        HashMap<String, Object> data = new HashMap<>();
        data.put("sort", sort);
        data.put("filter", filter);
        MenuManager.setNewData(player.getUniqueId(), data);
    }

    private static AuctionListing createListing() {
        AuctionListing listing = new AuctionListing();
        listing.setId(LISTING_ID);
        listing.setSellerId(player2.getUniqueId());
        listing.setSellerName("seller");
        listing.setItem(new ItemStack(Material.STONE));
        listing.setPrice(25);
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

    private static boolean setAuctionPurchaseFeedback(boolean enabled) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("auctionPurchaseFeedback");
        field.setAccessible(true);
        boolean previous = field.getBoolean(ConfigManager.getInstance());
        field.setBoolean(ConfigManager.getInstance(), enabled);
        return previous;
    }
}

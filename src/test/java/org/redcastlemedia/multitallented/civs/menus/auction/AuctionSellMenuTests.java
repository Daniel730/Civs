package org.redcastlemedia.multitallented.civs.menus.auction;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.bukkit.Material;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.PlayerInventoryImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;

public class AuctionSellMenuTests extends TestUtil {

    private Civilian civilian;
    private boolean previousUseAuctionHouse;

    @Before
    public void setup() throws Exception {
        MenuManager.getInstance().clearOpenMenus();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        previousUseAuctionHouse = setUseAuctionHouse(true);
        AuctionManager.getInstance().reload();
    }

    @After
    public void tearDown() throws Exception {
        setUseAuctionHouse(previousUseAuctionHouse);
        AuctionManager.getInstance().reload();
        MenuManager.getInstance().clearOpenMenus();
    }

    @Test
    public void openBrowseShouldOpenAuctionBrowseMenu() {
        AuctionSellMenu menu = new AuctionSellMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "open-browse", null);

        assertTrue(cancelled);
        assertEquals("auction-browse", getOpenMenuName(player.getUniqueId()));
    }

    @Test
    public void openMenuShouldShowBarrierWhenHandIsEmpty() {
        PlayerInventoryImpl originalInventory = (PlayerInventoryImpl) player.getInventory();
        try {
            PlayerInventoryImpl inventory = org.mockito.Mockito.spy(new PlayerInventoryImpl());
            org.mockito.Mockito.doReturn(new ItemStackImpl(Material.AIR, 0)).when(inventory).getItemInMainHand();
            org.mockito.Mockito.when(player.getInventory()).thenReturn(inventory);

            Inventory menuInventory = MenuManager.getInstance().openMenu(player, "auction-sell", new HashMap<>());

            ItemStack handSlot = menuInventory.getItem(13);
            assertEquals(Material.BARRIER, handSlot.getType());
            assertNotNull(CVItem.legacyDisplayName(handSlot));
        } finally {
            org.mockito.Mockito.when(player.getInventory()).thenReturn(originalInventory);
        }
    }

    @Test
    public void openMenuShouldMirrorHeldItemInCenterSlot() {
        PlayerInventoryImpl originalInventory = (PlayerInventoryImpl) player.getInventory();
        try {
            ItemStackImpl hand = new ItemStackImpl(Material.STONE, 2);
            PlayerInventoryImpl inventory = org.mockito.Mockito.spy(new PlayerInventoryImpl());
            org.mockito.Mockito.doReturn(hand).when(inventory).getItemInMainHand();
            org.mockito.Mockito.when(player.getInventory()).thenReturn(inventory);

            Inventory menuInventory = MenuManager.getInstance().openMenu(player, "auction-sell", new HashMap<>());

            ItemStack handSlot = menuInventory.getItem(13);
            assertEquals(Material.STONE, handSlot.getType());
            assertEquals(2, handSlot.getAmount());
        } finally {
            org.mockito.Mockito.when(player.getInventory()).thenReturn(originalInventory);
        }
    }

    @Test
    public void openMenuShouldShowSellHelpPaper() {
        Inventory menuInventory = MenuManager.getInstance().openMenu(player, "auction-sell", new HashMap<>());

        ItemStack helpSlot = menuInventory.getItem(4);
        assertEquals(Material.PAPER, helpSlot.getType());
        assertNotNull(CVItem.legacyDisplayName(helpSlot));
        assertNotNull(CVItem.legacyLore(helpSlot));
        assertTrue(CVItem.legacyLore(helpSlot).size() >= 4);
    }

    @SuppressWarnings("unchecked")
    private static String getOpenMenuName(UUID uuid) {
        try {
            Field field = MenuManager.class.getDeclaredField("openMenus");
            field.setAccessible(true);
            Map<UUID, String> openMenus = (Map<UUID, String>) field.get(null);
            return openMenus.get(uuid);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private static boolean setUseAuctionHouse(boolean enabled) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("useAuctionHouse");
        field.setAccessible(true);
        boolean previous = field.getBoolean(ConfigManager.getInstance());
        field.setBoolean(ConfigManager.getInstance(), enabled);
        return previous;
    }
}

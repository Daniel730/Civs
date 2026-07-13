package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.PlayerInventoryImpl;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.common.ConfirmationMenu;
import org.redcastlemedia.multitallented.civs.menus.common.ShopMenu;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

import net.milkbowl.vault.economy.Economy;

public class ShopMenuTest extends TestUtil {

    private Economy previousEconomy;

    @Before
    public void setup() {
        MenuManager.getInstance().clearOpenMenus();
        RegionManager.getInstance().reload();
        TownManager.getInstance().reload();
        previousEconomy = Civs.econ;
        Civs.econ = mock(Economy.class);
    }

    @After
    public void tearDown() {
        Civs.econ = previousEconomy;
    }

    @Test @SuppressWarnings("unchecked")
    public void shopMenuRootShouldNotDuplicateItems() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Map<String, Object> data = MenuManager.menus.get("shop").createData(civilian, new HashMap<>());
        List<CivItem> shopItems = (List<CivItem>) data.get("shopItems");
        HashSet<CivItem> items = new HashSet<>();
        for (CivItem civItem : shopItems) {
            if (items.contains(civItem)) {
                fail("Duplicate item found " + civItem.getProcessedName());
            }
            items.add(civItem);
        }
    }

    @Test @SuppressWarnings("unchecked")
    public void shopMenuShopsShouldNotDuplicateItems() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        HashMap<String, String> params = new HashMap<>();
        params.put("parent", "shops");
        Map<String, Object> data = MenuManager.menus.get("shop").createData(civilian, params);
        List<CivItem> shopItems = (List<CivItem>) data.get("shopItems");
        HashSet<String> items = new HashSet<>();
        for (CivItem civItem : shopItems) {
            if (items.contains(civItem.getProcessedName())) {
                fail("Duplicate item found " + civItem.getProcessedName());
            }
            items.add(civItem.getProcessedName());
        }
    }

    @Test @SuppressWarnings("unchecked")
    public void shopMenuShopsShouldNotDuplicateItemsForAdmins() {
        UUID uuid = new UUID(1, 9);
        Player player = mock(Player.class);
        when(player.isOp()).thenReturn(true);
        when(player.getInventory()).thenReturn(new PlayerInventoryImpl());
        when(Bukkit.getServer().getPlayer(uuid)).thenReturn(player);
        Civilian civilian = CivilianManager.getInstance().getCivilian(uuid);
        HashMap<String, String> params = new HashMap<>();
        params.put("parent", "utilities");
        Map<String, Object> data = MenuManager.menus.get("shop").createData(civilian, params);
        List<CivItem> shopItems = (List<CivItem>) data.get("shopItems");
        HashSet<String> items = new HashSet<>();
        for (CivItem civItem : shopItems) {
            if (items.contains(civItem.getProcessedName())) {
                fail("Duplicate item found " + civItem.getProcessedName());
            }
            items.add(civItem.getProcessedName());
        }
    }

    @Test @SuppressWarnings("unchecked")
    public void shopMenuShouldNotContainEmptyFolders() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Map<String, Object> data = MenuManager.menus.get("shop").createData(civilian, new HashMap<>());
        List<CivItem> shopItems = (List<CivItem>) data.get("shopItems");
        for (CivItem civItem : shopItems) {
            if ("defense".equals(civItem.getProcessedName())) {
                fail("Found empty defense folder in shop");
            }
        }
    }

    @Test @SuppressWarnings("unchecked")
    public void shopShouldContainTownLevelItems() {
        Town town = TownTests.loadTown("test", "settlement", new Location(TestUtil.world, 0, 0, 0));
        town.getRawPeople().put(TestUtil.player.getUniqueId(), Constants.OWNER);
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Map<String, Object> data = MenuManager.menus.get("shop").createData(civilian, new HashMap<>());
        List<CivItem> shopItems = (List<CivItem>) data.get("shopItems");
        boolean containsHousing = false;
        for (CivItem civItem : shopItems) {
            if ("housing".equals(civItem.getProcessedName())) {
                containsHousing = true;
            }
        }
        assertTrue(containsHousing);
    }

    @Test
    public void viewItemShouldOpenRegionTypeMenuForShopRegion() {
        RegionsTests.loadRegionTypeCobble();
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        ItemStackImpl shopItem = new ItemStackImpl(Material.CHEST, 1);
        ArrayList<String> lore = new ArrayList<>();
        lore.add(TestUtil.player.getUniqueId().toString());
        lore.add(org.bukkit.ChatColor.BLACK + "cobble");
        shopItem.getItemMeta().setLore(lore);
        HashMap<String, Object> data = new HashMap<>();
        data.put("sort", "category");
        MenuManager.setNewData(player.getUniqueId(), data);

        ShopMenu menu = (ShopMenu) MenuManager.menus.get("shop");
        boolean cancelled = menu.doActionAndCancel(civilian, "view-item", shopItem);

        assertTrue(cancelled);
        assertEquals("RegionType", MenuManager.getData(player.getUniqueId(), "menuName"));
    }

    @Test
    public void shopBuyConfirmShouldAddItemToPlayerInventory() {
        RegionsTests.loadRegionTypeCobble();
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        CivItem cobble = ItemManager.getInstance().getItemType("cobble");
        double price = cobble.getPrice(civilian);
        when(Civs.econ.has(player, price)).thenReturn(true);
        ((PlayerInventoryImpl) player.getInventory()).clear();

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put("item", cobble);
        menuData.put("type", "buy");
        MenuManager.setNewData(player.getUniqueId(), menuData);

        ConfirmationMenu menu = new ConfirmationMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "confirm", null);

        assertTrue(cancelled);
        assertTrue(player.getInventory().contains(Material.CHEST));
    }
}

package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Ignore;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.InventoryImpl;
import org.redcastlemedia.multitallented.civs.ItemMetaImpl;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianListener;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.regions.BlueprintsMenu;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class BlueprintsMenuTests extends TestUtil {
    private CustomMenu blueprintsMenu;
    private Civilian civilian;
    private InventoryImpl inventory;

    @Before
    public void setup() {
        MenuManager.clearData(TestUtil.player.getUniqueId());
        MenuManager.getInstance().clearOpenMenus();
        RegionManager.getInstance().reload();
        blueprintsMenu = MenuManager.menus.get("blueprints");
        this.inventory = new InventoryImpl();
        this.civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        RegionsTests.loadRegionTypeShelter();
        civilian.getStashItems().clear();
        civilian.getStashItems().put("shelter", 1);
    }

    @Test
    public void stashItemsShouldHaveStableAlphabeticalOrder() {
        RegionsTests.loadRegionTypeShelter();
        RegionsTests.loadRegionTypeCobble();
        civilian.getStashItems().clear();
        civilian.getStashItems().put("shelter", 1);
        civilian.getStashItems().put("cobble", 1);

        @SuppressWarnings("unchecked")
        Map<String, Integer> stash1 = (Map<String, Integer>) blueprintsMenu.createData(civilian, new HashMap<>()).get("stashItems");
        @SuppressWarnings("unchecked")
        Map<String, Integer> stash2 = (Map<String, Integer>) blueprintsMenu.createData(civilian, new HashMap<>()).get("stashItems");

        assertEquals(new ArrayList<>(stash1.keySet()), new ArrayList<>(stash2.keySet()));

        List<String> keys = new ArrayList<>(stash1.keySet());
        List<String> sorted = new ArrayList<>(keys);
        Collections.sort(sorted);
        assertEquals(sorted, keys);
        assertTrue(keys.contains("cobble"));
        assertTrue(keys.contains("shelter"));
        assertTrue(keys.indexOf("cobble") < keys.indexOf("shelter"));
    }

    @Test
    public void maxPageShouldUseFilteredRegionItemsOnly() {
        RegionsTests.loadRegionTypeShelter();
        civilian.getStashItems().clear();
        civilian.getStashItems().put("shelter", 1);
        for (int i = 0; i < 30; i++) {
            civilian.getStashItems().put("nonexistent_item_" + i, 1);
        }

        Map<String, Object> data = blueprintsMenu.createData(civilian, new HashMap<>());
        int maxPage = (int) data.get(Constants.MAX_PAGE);

        @SuppressWarnings("unchecked")
        Map<String, Integer> filteredItems = (Map<String, Integer>) data.get("stashItems");
        int expectedMaxPage = (int) Math.ceil((double) filteredItems.size()
                / (double) blueprintsMenu.itemsPerPage.get("blueprints"));
        expectedMaxPage = expectedMaxPage > 0 ? expectedMaxPage - 1 : 0;
        assertEquals(expectedMaxPage, maxPage);
        assertFalse(filteredItems.containsKey("nonexistent_item_0"));
    }

    @Test
    public void stashRegionItemsShouldBeEmpty() {
        civilian.getStashItems().put("nonexistent_region_xyz", 1);
        blueprintsMenu.createData(this.civilian, new HashMap<>());
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        assertEquals(1, (int) civilian.getStashItems().get("shelter"));
        assertNull(civilian.getStashItems().get("nonexistent_region_xyz"));
    }

    @Test
    public void stashItemsShouldSaveShelter() {
        RegionsTests.loadRegionTypeShelter();
        ItemStack itemStack = TestUtil.createUniqueItemStack(Material.CHEST, "Civs Shelter");
        blueprintsMenu.createMenu(this.civilian, new HashMap<>());
        inventory.setItem(0,itemStack);
        blueprintsMenu.onCloseMenu(this.civilian, this.inventory);
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        assertEquals(3, civilian.getStashItems().size());
    }

    @Test
    public void stashShouldNotContainShelter() {
        Region region = RegionsTests.createNewRegion("shelter", TestUtil.player.getUniqueId());
        RegionManager.getInstance().addRegion(region);
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        civilian.getStashItems().remove("shelter");
        MenuManager.menus.get("blueprints").createData(civilian, new HashMap<>());
        assertFalse(civilian.getStashItems().containsKey("shelter"));
    }

    @Test
    public void reloggingShouldNotReAddTheItem() {
        Region region = RegionsTests.createNewRegion("shelter", TestUtil.player.getUniqueId());
        RegionManager.getInstance().addRegion(region);
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        civilian.setStashItems(new HashMap<>());
        CivilianListener civilianListener = new CivilianListener();
        civilianListener.onCivilianJoin(new PlayerJoinEvent(TestUtil.player, ""));
        assertEquals(0, civilian.getStashItems().size());
    }

    @Test
    public void menuShouldNotDupeItems() {
        RegionsTests.loadRegionTypeCobble();
        this.blueprintsMenu.createMenu(civilian, new HashMap<>());
        ItemStackImpl itemStack = new ItemStackImpl(Material.CHEST, 1);
        itemStack.getItemMeta().setDisplayName("Civs Shelter");
        ArrayList<String> lore = new ArrayList<>();
        lore.add(TestUtil.player.getUniqueId().toString());
        lore.add(ChatColor.BLACK + "Shelter");
        itemStack.getItemMeta().setLore(lore);
        ItemStackImpl itemStack2 = new ItemStackImpl(Material.CHEST, 2);
        itemStack2.getItemMeta().setDisplayName("Civs Shelter");
        itemStack2.getItemMeta().setLore(lore);
        inventory.setItem(0, itemStack);
        inventory.setItem(1, itemStack2);
        this.blueprintsMenu.onCloseMenu(this.civilian, this.inventory);
        assertEquals(3, (int) this.civilian.getStashItems().get("shelter"));
    }

    @Test
    public void itemShouldBeCivsItem() {
        RegionsTests.loadRegionTypeCobble();
        ItemStackImpl itemStack = new ItemStackImpl(Material.CHEST, 1);
        ArrayList<String> lore = new ArrayList<>();
        lore.add("something");
        lore.add(ChatColor.BLACK +  "cobble");
        ItemMetaImpl itemMeta = new ItemMetaImpl("Civs Cobble", lore);
        itemStack.setItemMeta(itemMeta);
        assertTrue(CivItem.isCivsItem(itemStack));
    }

    @Test
    public void itemShouldNotBeCivsItem() {
        RegionsTests.loadRegionTypeCobble();
        ItemStackImpl itemStack = new ItemStackImpl(Material.CHEST, 1);
        ArrayList<String> lore = new ArrayList<>();
        ItemMetaImpl itemMeta = new ItemMetaImpl("Civs Cobble", lore);
        itemStack.setItemMeta(itemMeta);
        assertFalse(CivItem.isCivsItem(itemStack));
    }

    @Test
    public void deleteActionShouldRemoveBlueprintFromStash() {
        RegionsTests.loadRegionTypeShelter();
        RegionsTests.loadRegionTypeCobble();
        civilian.getStashItems().clear();
        civilian.getStashItems().put("shelter", 1);
        civilian.getStashItems().put("cobble", 2);

        ItemStackImpl shelterItem = new ItemStackImpl(Material.CHEST, 1);
        ArrayList<String> lore = new ArrayList<>();
        lore.add(TestUtil.player.getUniqueId().toString());
        lore.add(ChatColor.BLACK + "shelter");
        ItemMetaImpl meta = new ItemMetaImpl("Civs Shelter", lore);
        shelterItem.setItemMeta(meta);
        BlueprintsMenu menu = (BlueprintsMenu) blueprintsMenu;
        boolean cancelled = menu.doActionAndCancel(civilian, "delete", shelterItem);

        assertTrue(cancelled);
        assertFalse(civilian.getStashItems().containsKey("shelter"));
        assertEquals(2, (int) civilian.getStashItems().get("cobble"));
    }

    @Test
    public void goingBackFromBlueprintsShouldntClearDataBeforeClose() {
        Map<String, String> params = new HashMap<>();
        params.put("page", "0");
        MenuManager.getInstance().openMenu(TestUtil.player, "main", new HashMap<>());
        this.blueprintsMenu.createMenu(this.civilian, params);
        try {
            MenuManager.getInstance().goBack(this.civilian.getUuid());
        } catch (NullPointerException npe) {
            // no menu history in unit tests
        }
        this.blueprintsMenu.createMenu(this.civilian, params);
        assertTrue(this.civilian.getStashItems().containsKey("shelter"));
    }
}

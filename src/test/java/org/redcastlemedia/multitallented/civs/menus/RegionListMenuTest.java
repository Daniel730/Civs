package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.commands.RenamePlotCommandTest;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.menus.regions.RegionListMenu;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;

public class RegionListMenuTest extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.clearData(TestUtil.player.getUniqueId());
        RegionManager.getInstance().reload();
        civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
    }

    @After
    public void cleanup() {
        RegionManager.getInstance().reload();
    }

    @Test
    public void regionListMenuShouldProperlySetAction() {
        RegionsTests.createNewRegion("shelter", TestUtil.player.getUniqueId());
        Inventory inventory = MenuManager.openMenuFromString(civilian, "region-list");
        Map<ItemStack, Region> regionMap = (Map<ItemStack, Region>) MenuManager.getData(TestUtil.player.getUniqueId(), "regionMap");
        assertEquals(1, regionMap.values().size());
        assertEquals(inventory.getItem(9), regionMap.keySet().iterator().next());
    }

    @Test
    public void regionListMenuShouldShowCustomPlotName() {
        RenamePlotCommandTest.loadRegionTypePlot();
        Region region = RegionsTests.createNewRegion("plot11x11", TestUtil.player.getUniqueId());
        region.setDisplayName("MyPlot");
        MenuManager.openMenuFromString(civilian, "region-list");
        Map<ItemStack, Region> regionMap = (Map<ItemStack, Region>) MenuManager.getData(TestUtil.player.getUniqueId(), "regionMap");
        assertEquals(1, regionMap.values().size());
        ItemStack itemStack = regionMap.keySet().iterator().next();
        assertEquals("MyPlot", CVItem.legacyDisplayName(itemStack));
    }

    @Test
    public void regionListMenuShouldIncludeForSaleRegions() {
        Region region = loadForSaleRegion();
        RegionListMenu menu = (RegionListMenu) MenuManager.menus.get("region-list");
        HashMap<String, String> params = new HashMap<>();
        params.put("sell", "true");
        Map<String, Object> data = menu.createData(civilian, params);
        @SuppressWarnings("unchecked")
        java.util.List<Region> regions = (java.util.List<Region>) data.get("regions");
        assertTrue(regions.contains(region));
    }

    @Test
    public void viewRegionShouldResolveClonedItemByDisplayName() {
        RenamePlotCommandTest.loadRegionTypePlot();
        Region region = RegionsTests.createNewRegion("plot11x11", TestUtil.player.getUniqueId());
        region.setDisplayName("LookupPlot");
        MenuManager.openMenuFromString(civilian, "region-list");

        RegionListMenu menu = (RegionListMenu) MenuManager.menus.get("region-list");
        @SuppressWarnings("unchecked")
        Map<ItemStack, Region> regionMap = (Map<ItemStack, Region>) MenuManager.getData(
                TestUtil.player.getUniqueId(), "regionMap");
        ItemStack original = regionMap.keySet().iterator().next();
        ItemStack clone = original.clone();
        clone.getItemMeta().setDisplayName("LookupPlot");

        boolean cancelled = menu.doActionAndCancel(civilian, "view-region", clone);

        assertTrue(cancelled);
        assertNotNull(MenuManager.getData(TestUtil.player.getUniqueId(), "region"));
    }

    private static Region loadForSaleRegion() {
        Region region = RegionsTests.createNewRegion("shelter", player2.getUniqueId());
        region.setForSale(150);
        RegionManager.getInstance().addRegion(region);
        return region;
    }
}

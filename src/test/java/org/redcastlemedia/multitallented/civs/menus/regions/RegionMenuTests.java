package org.redcastlemedia.multitallented.civs.menus.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.effects.ForSaleEffect;
import org.redcastlemedia.multitallented.civs.util.Constants;

import net.milkbowl.vault.economy.Economy;

import static org.mockito.Mockito.mock;

public class RegionMenuTests extends TestUtil {

    private Civilian civilian;
    private Region region;
    private Economy previousEconomy;

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        region = loadBuyableRegion();
        region.setForSale(250);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.REGION, region);
        menuData.put("regionTypeName", region.getType());
        MenuManager.setNewData(player.getUniqueId(), menuData);
        previousEconomy = Civs.econ;
        Civs.econ = mock(Economy.class);
        when(Civs.econ.has(player, 250)).thenReturn(true);
    }

    @After
    public void tearDown() {
        Civs.econ = previousEconomy;
    }

    @Test
    public void cancelSaleShouldRunSellCommandForLoadedRegion() {
        RegionMenu menu = new RegionMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "cancel-sale", null);

        assertTrue(cancelled);
        verify(player).performCommand("cv sell");
    }

    @Test
    public void buyRegionShouldTransferOwnership() {
        UUID sellerId = player2.getUniqueId();
        region.getRawPeople().clear();
        region.getRawPeople().put(sellerId, Constants.OWNER);

        RegionMenu menu = new RegionMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "buy-region", null);

        assertTrue(cancelled);
        assertTrue(region.getRawPeople().containsKey(player.getUniqueId()));
        assertEquals(-1, region.getForSale(), 0.001);
        verify(Civs.econ).withdrawPlayer(player, 250);
    }

    @Test
    public void createDataShouldIgnoreMissingRegion() {
        RegionMenu menu = new RegionMenu();
        Map<String, String> params = new HashMap<>();
        params.put("region", "missing-region-id");

        Map<String, Object> data = menu.createData(civilian, params);

        assertFalse(data.containsKey("region"));
    }

    private static Region loadBuyableRegion() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("icon", "CHEST");
        config.set("effects", java.util.List.of(ForSaleEffect.KEY));
        ItemManager.getInstance().loadRegionType(config, "region_menu_buyable");
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType("region_menu_buyable");
        HashMap<java.util.UUID, String> people = new HashMap<>();
        people.put(player.getUniqueId(), Constants.OWNER);
        Location location = new Location(world, 20, 64, 20);
        Region region = new Region("region_menu_buyable", people, location,
                new int[] {3, 3, 3, 3, 3, 3}, (HashMap) regionType.getEffects().clone(), 0);
        RegionManager.getInstance().addRegion(region);
        return region;
    }
}

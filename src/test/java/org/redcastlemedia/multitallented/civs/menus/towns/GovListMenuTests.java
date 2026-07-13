package org.redcastlemedia.multitallented.civs.menus.towns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.towns.GovernmentManager;
import org.redcastlemedia.multitallented.civs.towns.GovernmentType;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class GovListMenuTests extends TestUtil {

    private Civilian civilian;
    private Town town;

    @Before
    public void setup() {
        GovernmentManager.getInstance().reload();
        TownManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        town = TownTests.loadTown("gov_list_town", "hamlet", TestUtil.block.getLocation());
        town.getRawPeople().put(player.getUniqueId(), Constants.OWNER);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.TOWN, town);
        menuData.put("govMap", new HashMap<ItemStack, String>());
        MenuManager.setNewData(player.getUniqueId(), menuData);
    }

    @Test
    public void selectGovShouldTransitionTownGovernment() {
        GovListMenu menu = new GovListMenu();
        ItemStack govItem = TestUtil.createUniqueItemStack(Material.BOOK, "Democracy");
        @SuppressWarnings("unchecked")
        HashMap<ItemStack, String> govMap = (HashMap<ItemStack, String>) MenuManager.getData(
                player.getUniqueId(), "govMap");
        govMap.put(govItem, GovernmentType.DEMOCRACY.name());

        boolean cancelled = menu.doActionAndCancel(civilian, "select-gov", govItem);

        assertTrue(cancelled);
        assertEquals(GovernmentType.DEMOCRACY.name(), town.getGovernmentType());
    }
}

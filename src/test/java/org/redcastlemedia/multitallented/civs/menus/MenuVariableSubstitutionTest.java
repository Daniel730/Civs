package org.redcastlemedia.multitallented.civs.menus;

import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class MenuVariableSubstitutionTest extends TestUtil {

    @Before
    public void setup() {
        MenuManager.clearData(player.getUniqueId());
    }

    @Test
    public void replaceVariablesShouldResolveDefaultUuidWithoutMenuData() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        MenuManager.clearData(player.getUniqueId());

        String resolved = CustomMenu.replaceVariables(civilian, "menu:player?uuid=$uuid$");

        assertEquals("menu:player?uuid=" + player.getUniqueId(), resolved);
        assertFalse(resolved.contains("$uuid$"));
    }

    @Test
    public void replaceVariablesShouldResolveDefaultClassWithoutMenuData() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        MenuManager.clearData(player.getUniqueId());
        if (civilian.getCurrentClass() == null) {
            return;
        }

        String resolved = CustomMenu.replaceVariables(civilian, "menu:spell-list?class=$class$");

        assertEquals("menu:spell-list?class=" + civilian.getCurrentClass().getId(), resolved);
        assertFalse(resolved.contains("$class$"));
    }

    @Test
    public void menuParamsShouldTreatUnresolvedPlaceholdersAsSelfUuid() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Map<String, String> params = new HashMap<>();
        params.put(Constants.UUID, "$uuid$");

        UUID resolved = MenuParams.resolveUuid(civilian, params);

        assertEquals(player.getUniqueId(), resolved);
    }

    @Test
    public void replaceVariablesShouldResolveUuidStoredAsString() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Map<String, Object> data = new HashMap<>();
        data.put(Constants.UUID, player.getUniqueId().toString());
        MenuManager.setNewData(player.getUniqueId(), data);

        String resolved = CustomMenu.replaceVariables(civilian, "menu:player?uuid=$uuid$");

        assertEquals("menu:player?uuid=" + player.getUniqueId(), resolved);
    }

    @Test
    public void replaceVariablesShouldResolveUuidStoredAsUuid() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Map<String, Object> data = new HashMap<>();
        data.put(Constants.UUID, player.getUniqueId());
        MenuManager.setNewData(player.getUniqueId(), data);

        String resolved = CustomMenu.replaceVariables(civilian, "menu:select-town?uuid=$uuid$");

        assertEquals("menu:select-town?uuid=" + player.getUniqueId(), resolved);
    }

    @Test
    public void replaceVariablesShouldResolveTownAndRegionPlaceholders() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Town town = TownTests.loadTown("test-town", "settlement", player.getLocation());
        Map<String, Object> data = new HashMap<>();
        data.put(Constants.TOWN, town);
        MenuManager.setNewData(player.getUniqueId(), data);

        String resolved = CustomMenu.replaceVariables(civilian, "menu:town?town=$town$");

        assertEquals("menu:town?town=test-town", resolved);
    }

    @Test
    public void openMenuFromStringShouldSubstitutePlaceholdersInQuery() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Map<String, Object> data = new HashMap<>();
        data.put(Constants.UUID, player.getUniqueId());
        MenuManager.setNewData(player.getUniqueId(), data);

        String menuString = CustomMenu.replaceVariables(civilian, "select-town?uuid=$uuid$");
        assertFalse(menuString.contains("$uuid$"));

        String[] menuSplit = menuString.split("\\?", 2);
        String[] splitParams = menuSplit[1].split("=", 2);
        assertEquals(player.getUniqueId().toString(), splitParams[1]);
    }

    @Test
    public void replaceVariablesShouldHandleReplacementValuesWithDollarSigns() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Map<String, Object> data = new HashMap<>();
        data.put(Constants.TOWN, TownTests.loadTown("$pecial-town", "settlement", player.getLocation()));
        MenuManager.setNewData(player.getUniqueId(), data);

        String resolved = CustomMenu.replaceVariables(civilian, "menu:town?town=$town$");

        assertEquals("menu:town?town=$pecial-town", resolved);
        assertFalse(resolved.contains("$town$"));
    }
}

package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.alliances.AllianceManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.commands.MenuCommand;
import org.redcastlemedia.multitallented.civs.menus.towns.SelectTownMenu;
import org.redcastlemedia.multitallented.civs.towns.GovernmentManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class SelectTownMenuTests extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.getInstance().reload();
        TownManager.getInstance().reload();
        AllianceManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
    }

    @Test
    public void townMenuShouldNotNull() {
        GovernmentManager.getInstance().reload();
        TownTests.loadTown("test", "settlement", new Location(TestUtil.world, 0, 0, 0));
        MenuCommand menuCommand = new MenuCommand();
        String[] args = {"menu", "town?selectedTown=test&preserveData=true"};
        menuCommand.runCommand(TestUtil.player, null, "cv", args);
    }

    @Test
    public void colonySelectShouldUseLegacyDisplayNameForTownLookup() {
        Town colonyTown = TownTests.loadTown("colony_town", "hamlet", TestUtil.block.getLocation());
        colonyTown.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        Town targetTown = TownTests.loadTown("target_town", "hamlet", TestUtil.block14.getLocation());

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put("colony", colonyTown.getName());
        MenuManager.setNewData(player.getUniqueId(), menuData);

        SelectTownMenu menu = new SelectTownMenu();
        ItemStack townItem = TestUtil.createUniqueItemStack(Material.PLAYER_HEAD, targetTown.getName());

        boolean cancelled = menu.doActionAndCancel(civilian, "select-town", townItem);

        assertTrue(cancelled);
        assertEquals(targetTown.getName(), colonyTown.getColonialTown());
    }

    @Test
    public void allyActionShouldUseLegacyDisplayNameForTownLookup() {
        Town toTown = TownTests.loadTown("ally_to_town", "hamlet", TestUtil.block6.getLocation());
        toTown.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        Town fromTown = TownTests.loadTown("ally_from_town", "hamlet", TestUtil.block8.getLocation());

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put("ally", true);
        menuData.put("allyTown", toTown.getName());
        MenuManager.setNewData(player.getUniqueId(), menuData);

        SelectTownMenu menu = new SelectTownMenu();
        ItemStack fromTownItem = TestUtil.createUniqueItemStack(Material.PLAYER_HEAD, fromTown.getName());

        boolean cancelled = menu.doActionAndCancel(civilian, "ally", fromTownItem);

        assertTrue(cancelled);
        assertTrue(toTown.getAllyInvites().contains(fromTown.getName()));
    }

    @Test
    public void unallyActionShouldUseLegacyDisplayNameForTownLookup() {
        Town toTown = TownTests.loadTown("unally_to_town", "hamlet", TestUtil.block9.getLocation());
        toTown.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        Town fromTown = TownTests.loadTown("unally_from_town", "hamlet", TestUtil.goldBlock0x1y1z.getLocation());
        AllianceManager.getInstance().allyTheseTowns(toTown, fromTown);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put("ally", false);
        menuData.put("allyTown", toTown.getName());
        MenuManager.setNewData(player.getUniqueId(), menuData);

        SelectTownMenu menu = new SelectTownMenu();
        ItemStack fromTownItem = TestUtil.createUniqueItemStack(Material.PLAYER_HEAD, fromTown.getName());

        boolean cancelled = menu.doActionAndCancel(civilian, "unally", fromTownItem);

        assertTrue(cancelled);
        assertFalse(AllianceManager.getInstance().isAllied(toTown, fromTown));
    }
}

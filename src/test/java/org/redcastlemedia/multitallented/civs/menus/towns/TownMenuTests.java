package org.redcastlemedia.multitallented.civs.menus.towns;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.HashSet;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.PlayerInventoryImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.alliances.AllianceManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.towns.Government;
import org.redcastlemedia.multitallented.civs.towns.GovernmentManager;
import org.redcastlemedia.multitallented.civs.towns.GovernmentType;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class TownMenuTests extends TestUtil {

    private Civilian civilian;
    private Town viewedTown;
    private Town ownedTown;

    @Before
    public void setup() {
        GovernmentManager.getInstance().reload();
        TownManager.getInstance().reload();
        AllianceManager.getInstance().reload();
        MenuManager.getInstance().clearOpenMenus();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        viewedTown = TownTests.loadTown("viewed_town", "hamlet", TestUtil.block.getLocation());
        viewedTown.getRawPeople().clear();
        ownedTown = TownTests.loadTown("owned_town", "hamlet", TestUtil.block14.getLocation());

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.TOWN, viewedTown);
        MenuManager.setNewData(player.getUniqueId(), menuData);
    }

    @Test
    public void allyActionShouldSendInviteFromOwnedTown() {
        TownMenu menu = new TownMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "ally", null);

        assertTrue(cancelled);
        assertTrue(viewedTown.getAllyInvites().contains(ownedTown.getName()));
    }

    @Test
    public void unallyActionShouldBreakAlliance() {
        AllianceManager.getInstance().allyTheseTowns(viewedTown, ownedTown);
        TownMenu menu = new TownMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "unally", null);

        assertTrue(cancelled);
        assertFalse(AllianceManager.getInstance().isAllied(viewedTown, ownedTown));
    }

    @Test
    public void leaveRevoltShouldRemovePlayer() {
        viewedTown.getRevolt().add(player.getUniqueId());
        TownMenu menu = new TownMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "leave-revolt", null);

        assertTrue(cancelled);
        assertFalse(viewedTown.getRevolt().contains(player.getUniqueId()));
    }

    @Test
    public void joinRevoltShouldConsumeCostAndAddPlayer() {
        viewedTown.setGovernmentType(GovernmentType.DEMOCRACY.name());
        viewedTown.getRawPeople().put(player.getUniqueId(), Constants.MEMBER);
        ((PlayerInventoryImpl) player.getInventory()).clear();
        ((PlayerInventoryImpl) player.getInventory()).setItem(0, new ItemStack(Material.GUNPOWDER, 64));
        TownMenu menu = new TownMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "join-revolt", null);

        assertTrue(cancelled);
        assertTrue(viewedTown.getRevolt().contains(player.getUniqueId()));
        assertFalse(player.getInventory().contains(Material.GUNPOWDER, 64));
    }

    @Test
    public void allyWithMultipleOwnedTownsShouldOpenSelectTownMenu() {
        Town secondOwnedTown = TownTests.loadTown("second_owned_town", "hamlet", TestUtil.block6.getLocation());
        secondOwnedTown.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        TownMenu menu = new TownMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "ally", null);

        assertTrue(cancelled);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), "select-town"));
    }

    @Test
    public void colonialMasterShouldOpenInvitePeopleMenu() {
        Government colonialism = new Government("COLONIALISM", GovernmentType.COLONIALISM,
                new HashSet<>(), null, new java.util.ArrayList<>(), true);
        TownTests.addGovernmentType(colonialism);
        viewedTown.setGovernmentType("COLONIALISM");
        viewedTown.setColonialTown(ownedTown.getName());
        viewedTown.getRawPeople().clear();
        viewedTown.getRawPeople().put(player2.getUniqueId(), Constants.OWNER);

        TownMenu menu = new TownMenu();
        boolean cancelled = menu.doActionAndCancel(civilian,
                "menu:people?town=" + viewedTown.getName() + "&invite=true", null);

        assertTrue(cancelled);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), "people"));
    }

    @Test
    public void leaveTownActionShouldOpenConfirmationMenu() {
        viewedTown.getRawPeople().put(player.getUniqueId(), Constants.MEMBER);

        TownMenu menu = new TownMenu();
        boolean cancelled = menu.doActionAndCancel(civilian,
                "menu:confirmation?town=" + viewedTown.getName() + "&type=leave", null);

        assertTrue(cancelled);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), "confirmation"));
    }
}

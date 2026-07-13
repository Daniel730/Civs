package org.redcastlemedia.multitallented.civs.menus.people;

import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.UUID;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class PeopleMenuTests extends TestUtil {

    private Civilian civilian;
    private Town town;

    @Before
    public void setup() {
        TownManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        town = TownTests.loadTown("people_menu_town", "hamlet", TestUtil.block.getLocation());
        town.getRawPeople().put(player.getUniqueId(), Constants.OWNER);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.TOWN, town);
        menuData.put("invite", true);
        MenuManager.setNewData(player.getUniqueId(), menuData);
    }

    @Test
    public void inviteActionShouldUseLegacyDisplayNameForCommand() {
        PeopleMenu menu = new PeopleMenu();
        ItemStack inviteItem = TestUtil.createUniqueItemStack(Material.PLAYER_HEAD, "InvitedPlayer");
        HashMap<ItemStack, UUID> civMap = new HashMap<>();
        civMap.put(inviteItem, player2.getUniqueId());
        MenuManager.putData(player.getUniqueId(), "civMap", civMap);
        when(player.getName()).thenReturn("Owner");

        boolean cancelled = menu.doActionAndCancel(civilian, "take-action", inviteItem);

        assertTrue(cancelled);
        verify(player).performCommand("cv invite InvitedPlayer people_menu_town");
    }
}

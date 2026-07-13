package org.redcastlemedia.multitallented.civs.menus.towns;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.alliances.AllianceManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class TownInvitesMenuTests extends TestUtil {

    private Civilian civilian;
    private Town town;
    private Town inviterTown;

    @Before
    public void setup() {
        TownManager.getInstance().reload();
        AllianceManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        town = TownTests.loadTown("invites_town", "hamlet", TestUtil.block.getLocation());
        town.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        inviterTown = TownTests.loadTown("inviter_town", "hamlet", TestUtil.block14.getLocation());

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.TOWN, town);
        MenuManager.setNewData(player.getUniqueId(), menuData);
    }

    @Test
    public void acceptInviteShouldUseLegacyDisplayNameForTownLookup() {
        town.getAllyInvites().add(inviterTown.getName());
        TownInvitesMenu menu = new TownInvitesMenu();
        ItemStack inviteItem = TestUtil.createUniqueItemStack(Material.PLAYER_HEAD, inviterTown.getName());

        boolean cancelled = menu.doActionAndCancel(civilian, "accept-invite", inviteItem);

        assertTrue(cancelled);
        assertFalse(town.getAllyInvites().contains(inviterTown.getName()));
        assertTrue(AllianceManager.getInstance().isAllied(town, inviterTown));
    }

    @Test
    public void declineAllInvitesShouldClearPendingInvites() {
        town.getAllyInvites().add(inviterTown.getName());
        town.getAllyInvites().add("other_town");
        TownInvitesMenu menu = new TownInvitesMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "decline-all-invites", null);

        assertTrue(cancelled);
        assertTrue(town.getAllyInvites().isEmpty());
    }
}

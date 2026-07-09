package org.redcastlemedia.multitallented.civs.menus.alliance;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;

import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.alliances.Alliance;
import org.redcastlemedia.multitallented.civs.alliances.AllianceManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.towns.GovernmentManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.towns.TownType;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class AllianceMenuActionTests extends TestUtil {

    private Civilian civilian;
    private Alliance alliance;
    private Town ownedTown;
    private Town allyTown1;
    private Town allyTown2;

    @Before
    public void setup() {
        GovernmentManager.getInstance().reload();
        TownManager.getInstance().reload();
        AllianceManager.getInstance().reload();
        MenuManager.getInstance().clearOpenMenus();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());

        TownType townType = (TownType) ItemManager.getInstance().getItemType("hamlet");
        ownedTown = TownTests.loadTown("alliance_owned", townType.getProcessedName(), TestUtil.block.getLocation());
        ownedTown.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        allyTown1 = TownTests.loadTown("alliance_ally_one", townType.getProcessedName(), TestUtil.block6.getLocation());
        allyTown2 = TownTests.loadTown("alliance_ally_two", townType.getProcessedName(), TestUtil.block8.getLocation());

        AllianceManager.getInstance().allyTheseTowns(ownedTown, allyTown1);
        alliance = AllianceManager.getInstance().getAllAlliances().get(0);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put("alliance", alliance);
        menuData.put("selectedTown", ownedTown);
        menuData.put("page", 0);
        menuData.put("maxPage", 0);
        MenuManager.setNewData(player.getUniqueId(), menuData);
    }

    @Test
    public void leaveAllianceShouldUnallyOtherMembers() {
        AllianceMenu menu = new AllianceMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "leave-alliance", null);

        assertTrue(cancelled);
        assertFalse(AllianceManager.getInstance().isAllied(ownedTown, allyTown1));
    }

    @Test
    public void leaveAllianceWithoutSelectedTownShouldOpenSelectTownMenu() {
        MenuManager.putData(player.getUniqueId(), "selectedTown", null);
        AllianceMenu menu = new AllianceMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "leave-alliance", null);

        assertTrue(cancelled);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), "select-town"));
    }

    @Test
    public void memberClickShouldOpenTownMenu() {
        AllianceMenu menu = new AllianceMenu();

        boolean cancelled = menu.doActionAndCancel(civilian, "menu:town?town=" + allyTown1.getName(), null);

        assertTrue(cancelled);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), Constants.TOWN));
    }
}

package org.redcastlemedia.multitallented.civs.menus.people;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.CustomMenu;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class MemberActionMenuTests extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
    }

    @Test
    public void memberActionTownCommandsShouldSubstituteUuidAndKey() {
        Town town = TownTests.loadTown("member-town", "settlement", player.getLocation());
        UUID targetUuid = player2.getUniqueId();
        Map<String, Object> data = new HashMap<>();
        data.put("uuid", targetUuid);
        data.put("town", town);
        data.put("key", "member-town");
        MenuManager.setNewData(player.getUniqueId(), data);

        String setOwner = CustomMenu.replaceVariables(civilian, "command:cv setowner $uuid$ $key$");
        String removeMember = CustomMenu.replaceVariables(civilian, "command:cv removemember $uuid$ $key$");

        assertEquals("command:cv setowner " + targetUuid + " member-town", setOwner);
        assertEquals("command:cv removemember " + targetUuid + " member-town", removeMember);
        assertFalse(setOwner.contains("$uuid$"));
        assertFalse(setOwner.contains("$key$"));
    }

    @Test
    public void memberActionRegionCommandsShouldSubstituteUuidAndKey() {
        Region region = RegionsTests.createNewRegion("shelter", player.getUniqueId());
        UUID targetUuid = player2.getUniqueId();
        Map<String, Object> data = new HashMap<>();
        data.put("uuid", targetUuid);
        data.put(Constants.REGION, region);
        data.put("key", region.getId());
        MenuManager.setNewData(player.getUniqueId(), data);

        String setOwner = CustomMenu.replaceVariables(civilian, "command:cv setowner $uuid$ $key$");

        assertEquals("command:cv setowner " + targetUuid + " " + region.getId(), setOwner);
    }

    @Test
    public void stringifyDataShouldHandleNullTownSafely() {
        assertEquals("", CustomMenu.stringifyData("town", null));
        assertEquals("", CustomMenu.stringifyData("region", null));
    }
}

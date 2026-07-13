package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertFalse;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;

public class MenuManagerRefreshMenuTests extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.getInstance().clearOpenMenus();
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
    }

    @Test
    public void refreshMenuShouldIgnoreStaleMenuName() throws Exception {
        putOpenMenu(player.getUniqueId(), "definitely-not-a-real-menu");

        MenuManager.getInstance().refreshMenu(civilian);

        assertFalse(MenuManager.getInstance().hasMenuOpen(player.getUniqueId()));
    }

    @SuppressWarnings("unchecked")
    private static void putOpenMenu(UUID uuid, String menuName) throws Exception {
        Field field = MenuManager.class.getDeclaredField("openMenus");
        field.setAccessible(true);
        Map<UUID, String> openMenus = (Map<UUID, String>) field.get(null);
        openMenus.put(uuid, menuName);
    }
}

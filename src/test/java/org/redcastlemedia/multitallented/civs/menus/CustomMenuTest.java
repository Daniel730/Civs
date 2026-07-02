package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertTrue;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;

public class CustomMenuTest extends TestUtil {

    // Regression test: Civs.perm is null whenever no Vault permission provider is
    // registered (e.g. no permission plugin installed). A "permission:" menu action
    // used to call PermissionUtil.applyPermission() unconditionally, which
    // dereferences Civs.perm and threw an NPE. TutorialManager already guarded this
    // with a null check before applying reward permissions; CustomMenu should do
    // the same.
    @Test
    public void permissionActionShouldNotThrowWhenPermIsNull() {
        Civs.perm = null;
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        ItemStack itemStack = TestUtil.createUniqueItemStack(Material.CHEST, "Test Item");
        CustomMenu customMenu = new CustomMenu();

        boolean shouldCancel = customMenu.doActionAndCancel(civilian, "permission:civs.test", itemStack);

        assertTrue(shouldCancel);
    }
}

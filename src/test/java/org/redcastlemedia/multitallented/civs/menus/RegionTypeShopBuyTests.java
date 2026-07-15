package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.when;

import java.util.HashMap;

import org.bukkit.Material;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.PermissionUtil;

import net.milkbowl.vault.permission.Permission;

/**
 * Buy emerald must honor Bukkit permission defaults (plugin.yml civs.shop
 * default: true) even when Vault {@code Civs.perm} is unset.
 */
public class RegionTypeShopBuyTests extends TestUtil {

    private Permission previousPerm;

    @Before
    public void setup() {
        MenuManager.getInstance().clearOpenMenus();
        RegionsTests.loadRegionTypeCobble();
        previousPerm = Civs.perm;
        Civs.perm = null;
        when(player.isOp()).thenReturn(false);
        when(player.hasPermission("civs.shop")).thenReturn(false);
        when(player.hasPermission(Constants.ADMIN_PERMISSION)).thenReturn(false);
    }

    @After
    public void tearDown() {
        Civs.perm = previousPerm;
        when(player.isOp()).thenReturn(false);
        when(player.hasPermission("civs.shop")).thenReturn(false);
        when(player.hasPermission(Constants.ADMIN_PERMISSION)).thenReturn(false);
    }

    @Test
    public void shopAccessUsesBukkitHasPermissionNotVaultPerm() {
        Civs.perm = null;
        when(player.hasPermission("civs.shop")).thenReturn(true);
        assertTrue(PermissionUtil.hasShopAccess(player));

        when(player.hasPermission("civs.shop")).thenReturn(false);
        assertFalse(PermissionUtil.hasShopAccess(player));
    }

    @Test
    public void buyEmeraldShowsWhenVaultPermNullAndBukkitGrantsShop() {
        when(player.hasPermission("civs.shop")).thenReturn(true);

        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        HashMap<String, String> params = new HashMap<>();
        params.put(Constants.REGION_TYPE, "cobble");
        params.put(Constants.SHOW_PRICE, "true");
        Inventory inventory = MenuManager.menus.get("region-type").createMenu(civilian, params);
        ItemStack priceIcon = inventory.getItem(0);

        assertEquals(Material.EMERALD, priceIcon.getType());
    }
}

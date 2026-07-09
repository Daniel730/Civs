package org.redcastlemedia.multitallented.civs.regions.placement;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.ArrayList;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ItemMetaImpl;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.PlayerInventoryImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

public class PlacementReopenMenuTest extends TestUtil {

    @Before
    public void setup() throws Exception {
        ensurePlacementSessionManager();
        RegionManager.getInstance().reload();
        MenuManager.getInstance().clearOpenMenus();
        ((PlayerInventoryImpl) player.getInventory()).clear();
    }

    @Test
    public void instantPlacementFailureReopensPlacementModeMenu() throws Exception {
        RegionType regionType = loadInstantRegionType();
        ItemStack token = new ItemStackImpl(Material.CHEST, 1);
        ItemMetaImpl meta = (ItemMetaImpl) token.getItemMeta();
        meta.getLore().add("");
        meta.getLore().add(regionType.getProcessedName());
        ((PlayerInventoryImpl) player.getInventory()).setItem(0, token);
        assertNotNull(CivItem.getFromItemStack(((PlayerInventoryImpl) player.getInventory()).getContents()[0]));

        Location target = new Location(world, 50, 64, 50);
        PlacementSession session = new PlacementSession(target, regionType, BlockFace.NORTH);
        session.setMode(PlacementMode.INSTANT);
        PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);

        boolean success = RegionManager.getInstance().executePlacement(player, session);

        assertFalse(success);
        assertTrue(MenuManager.getInstance().hasMenuOpen(player.getUniqueId(), "placement-mode"));
    }

    private RegionType loadInstantRegionType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("CHEST*2");
        config.set("build-reqs", reqs);
        config.set("build-radius", 3);
        config.set("instant-build", true);
        return ItemManager.getInstance().loadRegionType(config, "placement_reopen_test");
    }

    private static void ensurePlacementSessionManager() throws Exception {
        Field field = PlacementSessionManager.class.getDeclaredField("instance");
        field.setAccessible(true);
        if (field.get(null) == null) {
            field.set(null, new PlacementSessionManager());
        }
    }
}

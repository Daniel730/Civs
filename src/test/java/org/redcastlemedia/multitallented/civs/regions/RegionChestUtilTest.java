package org.redcastlemedia.multitallented.civs.regions;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.CVInventory;
import org.redcastlemedia.multitallented.civs.items.ItemManager;

import java.util.ArrayList;
import java.util.HashMap;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class RegionChestUtilTest extends TestUtil {

    private static final String FARM_TYPE = "single_chest_farm";

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        loadFarmRegionType();
    }

    private static void loadFarmRegionType() {
        FileConfiguration config = new YamlConfiguration();
        config.set("groups", new ArrayList<>(java.util.List.of("farm")));
        config.set("build-radius", 2);
        config.set("period", 300);
        ItemManager.getInstance().loadRegionType(config, FARM_TYPE);
    }

    private static int[] radii() {
        return new int[] {5, 5, 5, 5, 5, 5};
    }

    @Test
    public void singleChestFarmUsesIconChestForOutput() {
        Location center = new Location(world, 5000, 64, 5000);
        Block chestBlock = createBlock(Material.CHEST, center);
        world.putBlock(5000, 64, 5000, chestBlock);

        Region region = new Region(FARM_TYPE, new HashMap<>(), center, radii(), new HashMap<>(), 0);

        assertTrue(RegionChestUtil.isFarmRegion(region));

        CVInventory input = RegionChestUtil.getInputChest(region);
        CVInventory output = RegionChestUtil.findOutputChest(region, new ItemStack(Material.WHEAT, 16));

        assertNotNull(input);
        assertNotNull(output);
        assertSameBlock(input.getLocation(), output.getLocation());
    }

    @Test
    public void nonFarmRegionIsNotFarm() {
        FileConfiguration config = new YamlConfiguration();
        config.set("build-radius", 2);
        ItemManager.getInstance().loadRegionType(config, "utility_chest");
        Location center = new Location(world, 5100, 64, 5100);
        Block chestBlock = createBlock(Material.CHEST, center);
        world.putBlock(5100, 64, 5100, chestBlock);

        Region region = new Region("utility_chest", new HashMap<>(), center, radii(), new HashMap<>(), 0);
        assertFalse(RegionChestUtil.isFarmRegion(region));
        assertSameBlock(
                RegionChestUtil.getInputChest(region).getLocation(),
                RegionChestUtil.findOutputChest(region).getLocation());
    }

    private static void assertSameBlock(Location a, Location b) {
        assertEquals(a.getBlockX(), b.getBlockX());
        assertEquals(a.getBlockY(), b.getBlockY());
        assertEquals(a.getBlockZ(), b.getBlockZ());
        assertEquals(a.getWorld(), b.getWorld());
    }
}

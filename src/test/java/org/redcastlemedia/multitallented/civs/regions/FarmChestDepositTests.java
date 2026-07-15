package org.redcastlemedia.multitallented.civs.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.CVInventory;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class FarmChestDepositTests extends TestUtil {

    private static final String FARM_TYPE = "deposit_farm";

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        loadFarmType();
    }

    private static void loadFarmType() {
        FileConfiguration config = new YamlConfiguration();
        config.set("groups", new ArrayList<>(java.util.List.of("farm")));
        config.set("build-radius", 3);
        config.set("period", 1);
        config.set("upkeep.0.tools", new ArrayList<>(java.util.List.of("STONE_HOE")));
        config.set("upkeep.0.output", new ArrayList<>(java.util.List.of("WHEAT*8")));
        ItemManager.getInstance().loadRegionType(config, FARM_TYPE);
    }

    private static int[] radii() {
        return new int[] {5, 5, 5, 5, 5, 5};
    }

    @Test
    public void farmUpkeepDepositsOutputIntoNearbyChest() {
        Location center = new Location(world, 6000, 64, 6000);
        Location nearby = new Location(world, 6002, 64, 6000);

        Block centerChestBlock = createBlock(Material.CHEST, center);
        Block nearbyChestBlock = createBlock(Material.CHEST, nearby);
        world.putBlock(6000, 64, 6000, centerChestBlock);
        world.putBlock(6002, 64, 6000, nearbyChestBlock);

        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(new UUID(1, 4), Constants.OWNER);
        Region region = new Region(FARM_TYPE, owners, center, radii(), new HashMap<>(), 0);
        RegionManager.getInstance().addRegion(region);

        Chest input = (Chest) center.getBlock().getState();
        input.getBlockInventory().clear();
        input.getBlockInventory().setItem(0, new ItemStackImpl(Material.STONE_HOE, 1));

        Chest output = (Chest) nearby.getBlock().getState();
        output.getBlockInventory().clear();

        CVInventory chosen = RegionChestUtil.findOutputChest(region, new ItemStack(Material.WHEAT, 8));
        assertNotNull(chosen);
        assertEquals(6002, chosen.getLocation().getBlockX());

        assertTrue(region.runUpkeep(false));

        boolean foundWheat = false;
        for (ItemStack stack : output.getBlockInventory().getContents()) {
            if (stack != null && stack.getType() == Material.WHEAT) {
                foundWheat = true;
                assertEquals(8, stack.getAmount());
            }
        }
        assertTrue("Nearby chest should receive farm output", foundWheat);
    }

    @Test
    public void farmUpkeepStillRunsAfterCheckedRegionWhenToolsAdded() {
        Location center = new Location(world, 6100, 64, 6100);
        Block centerChestBlock = createBlock(Material.CHEST, center);
        world.putBlock(6100, 64, 6100, centerChestBlock);

        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(new UUID(1, 4), Constants.OWNER);
        Region region = new Region(FARM_TYPE, owners, center, radii(), new HashMap<>(), 0);
        RegionManager.getInstance().addRegion(region);

        Chest input = (Chest) center.getBlock().getState();
        input.getBlockInventory().clear();

        // First tick: missing tools — marks region checked (legacy stuck path).
        assertFalse(region.runUpkeep(false));
        RegionManager.getInstance().addCheckedRegion(region);
        assertFalse(RegionManager.getInstance().hasRegionChestChanged(region));

        // Tools appear without a chest-open event (e.g. hopper / creative set).
        input.getBlockInventory().setItem(0, new ItemStackImpl(Material.STONE_HOE, 1));

        assertTrue("Farm must still run after checked-region + tools added",
                region.runUpkeep(false));
    }
}

package org.redcastlemedia.multitallented.civs.regions;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Set;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class RegionInputChestFilterTests extends TestUtil {

    private static final String FARM_TYPE = "filter_farm";

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        FileConfiguration config = new YamlConfiguration();
        config.set("groups", new ArrayList<>(java.util.List.of("farm")));
        config.set("build-radius", 3);
        config.set("period", 1);
        config.set("upkeep.0.tools", new ArrayList<>(java.util.List.of("STONE_HOE")));
        config.set("upkeep.0.reagents", new ArrayList<>(java.util.List.of("BONE_MEAL*1")));
        config.set("upkeep.0.output", new ArrayList<>(java.util.List.of("WHEAT*8")));
        ItemManager.getInstance().loadRegionType(config, FARM_TYPE);
    }

    @Test
    public void allowedMaterialsIncludeToolsAndReagents() {
        Location center = new Location(world, 6100, 64, 6100);
        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(new UUID(1, 5), Constants.OWNER);
        Region region = new Region(FARM_TYPE, owners, center, new int[] {5, 5, 5, 5, 5, 5}, new HashMap<>(), 0);

        Set<Material> allowed = RegionInputChestFilter.getAllowedInputMaterials(region);
        assertTrue(allowed.contains(Material.STONE_HOE));
        assertTrue(allowed.contains(Material.BONE_MEAL));
        assertFalse(allowed.contains(Material.DIAMOND));
    }

    @Test
    public void isAllowedInInputRespectsWhitelist() {
        Location center = new Location(world, 6110, 64, 6110);
        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(new UUID(1, 6), Constants.OWNER);
        Region region = new Region(FARM_TYPE, owners, center, new int[] {5, 5, 5, 5, 5, 5}, new HashMap<>(), 0);

        assertTrue(RegionInputChestFilter.isAllowedInInput(region, new ItemStackImpl(Material.STONE_HOE, 1)));
        assertTrue(RegionInputChestFilter.isAllowedInInput(region, new ItemStackImpl(Material.BONE_MEAL, 4)));
        assertFalse(RegionInputChestFilter.isAllowedInInput(region, new ItemStackImpl(Material.DIRT, 1)));
        assertTrue(RegionInputChestFilter.isAllowedInInput(region, new ItemStack(Material.AIR)));
    }
}

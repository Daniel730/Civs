package org.redcastlemedia.multitallented.civs.regions.placement;

import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import java.util.ArrayList;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class InventoryRequirementCheckerTests extends TestUtil {

    @Before
    public void setup() {
        player.getInventory().clear();
        ItemManager.getInstance();
    }

    @Test
    public void hasMaterialsWhenInventoryContainsReqs() {
        RegionType type = loadSimpleType();
        player.getInventory().setItem(0, new ItemStack(Material.CHEST, 2));
        assertTrue(InventoryRequirementChecker.hasMaterials(player, type));
    }

    @Test
    public void missingMaterialsWhenChestAbsent() {
        RegionType type = loadSimpleType();
        assertFalse(InventoryRequirementChecker.hasMaterials(player, type));
    }

    @Test
    public void consumeMaterialsRemovesFromInventory() {
        RegionType type = loadSimpleType();
        player.getInventory().setItem(0, new ItemStack(Material.CHEST, 2));
        assertTrue(InventoryRequirementChecker.consumeMaterials(player, type));
        assertFalse(InventoryRequirementChecker.hasMaterials(player, type));
    }

    @Test
    public void waterBucketCountsAsWaterRequirement() {
        RegionType type = loadWaterType();
        player.getInventory().setItem(0, new ItemStack(Material.WATER_BUCKET, 1));
        assertTrue(InventoryRequirementChecker.hasMaterials(player, type));
    }

    private RegionType loadSimpleType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("CHEST*2");
        config.set("build-reqs", reqs);
        config.set("build-radius", 3);
        return ItemManager.getInstance().loadRegionType(config, "inv_check_type");
    }

    private RegionType loadWaterType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("WATER*1");
        config.set("build-reqs", reqs);
        config.set("build-radius", 3);
        return ItemManager.getInstance().loadRegionType(config, "inv_water_type");
    }
}

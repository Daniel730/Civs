package org.redcastlemedia.multitallented.civs.regions;

import com.google.common.base.Enums;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;

import java.util.ArrayList;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class FarmRequirementTests extends TestUtil {

    private static final Material WATER_CAULDRON =
            Enums.getIfPresent(Material.class, "WATER_CAULDRON").orNull();

    @Before
    public void onBefore() {
        RegionManager.getInstance().reload();
    }

    private static void loadRegionTypeWithReq(String name, String req) {
        FileConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add(req);
        config.set("build-reqs", reqs);
        config.set("build-radius", 5);
        ItemManager.getInstance().loadRegionType(config, name);
    }

    private static void placeBlock(int x, int y, int z, Material material) {
        Block block = createBlock(material, new Location(world, x, y, z));
        world.putBlock(x, y, z, block);
    }

    private static RegionBlockCheckResponse checkReq(String regionType, int x, int y, int z) {
        RegionType type = (RegionType) ItemManager.getInstance().getItemType(regionType);
        Location center = new Location(world, x + 0.5, y + 0.5, z + 0.5);
        return Region.hasRequiredBlocksOnCenter(type, center);
    }

    @Test
    public void waterReqAcceptsWaterBlock() {
        loadRegionTypeWithReq("water_farm", "WATER*1");
        placeBlock(3000, 0, 0, Material.WATER);
        assertNull(checkReq("water_farm", 3000, 0, 0).getMissingItems());
    }

    @Test
    public void waterReqAcceptsWaterCauldronBlock() {
        Assume.assumeNotNull(WATER_CAULDRON);
        loadRegionTypeWithReq("water_farm_cauldron", "WATER*1");
        placeBlock(3100, 0, 0, WATER_CAULDRON);
        assertNull(checkReq("water_farm_cauldron", 3100, 0, 0).getMissingItems());
    }

    @Test
    public void cauldronReqAcceptsEmptyCauldron() {
        loadRegionTypeWithReq("cauldron_farm", "CAULDRON*1");
        placeBlock(3200, 0, 0, Material.CAULDRON);
        assertNull(checkReq("cauldron_farm", 3200, 0, 0).getMissingItems());
    }

    @Test
    public void cauldronReqAcceptsWaterCauldronBlock() {
        Assume.assumeNotNull(WATER_CAULDRON);
        loadRegionTypeWithReq("cauldron_farm_water_cauldron", "CAULDRON*1");
        placeBlock(3300, 0, 0, WATER_CAULDRON);
        assertNull(checkReq("cauldron_farm_water_cauldron", 3300, 0, 0).getMissingItems());
    }

    @Test
    public void cauldronReqAcceptsWaterBlock() {
        loadRegionTypeWithReq("cauldron_farm_water", "CAULDRON*1");
        placeBlock(3400, 0, 0, Material.WATER);
        assertNull(checkReq("cauldron_farm_water", 3400, 0, 0).getMissingItems());
    }

    @Test
    public void waterReqRejectsEmptyCauldron() {
        loadRegionTypeWithReq("water_farm_strict", "WATER*1");
        placeBlock(3500, 0, 0, Material.CAULDRON);
        assertNotNull(checkReq("water_farm_strict", 3500, 0, 0).getMissingItems());
    }

    private static void loadAsymmetricRegionType(String name, String req, int radiusX, int radiusZ) {
        FileConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add(req);
        config.set("build-reqs", reqs);
        config.set("build-radius-x", radiusX);
        config.set("build-radius-y", radiusZ);
        config.set("build-radius-z", radiusZ);
        ItemManager.getInstance().loadRegionType(config, name);
    }

    @Test
    public void centerScanUsesZRadiusForZAxis() {
        // Non-cubic footprint: X radius 1, Z radius 5. The required block is placed 4
        // blocks along +Z from center -> inside the Z radius but outside the X radius.
        // With the correct Z-axis scan it is found; the old code scanned Z with the X
        // radius and missed it.
        loadAsymmetricRegionType("asym_z_farm", "DIAMOND_BLOCK*1", 1, 5);
        placeBlock(3600, 5, 4, Material.DIAMOND_BLOCK);
        RegionType type = (RegionType) ItemManager.getInstance().getItemType("asym_z_farm");
        Location center = new Location(world, 3600 + 0.5, 5 + 0.5, 0 + 0.5);
        assertNull(Region.hasRequiredBlocksOnCenter(type, center).getMissingItems());
    }
}

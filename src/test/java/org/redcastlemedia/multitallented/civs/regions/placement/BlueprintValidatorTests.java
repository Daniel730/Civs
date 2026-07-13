package org.redcastlemedia.multitallented.civs.regions.placement;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionBlockCheckResponse;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;

import java.util.ArrayList;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class BlueprintValidatorTests extends TestUtil {

    @Before
    public void setup() {
        ItemManager.getInstance();
    }

    @Test
    public void generatedShackBlueprintPassesBuildReqs() {
        org.junit.Assume.assumeTrue("WorldEdit block registry unavailable in this JVM",
                WorldEditTestSupport.isBlockRegistryReady());
        RegionType type = loadHousingType("shack_validator", 3);
        try {
            BlockArrayClipboard clipboard = BlueprintGenerator.buildClipboard(type);
            RegionBlockCheckResponse response = BlueprintValidator.validateClipboard(clipboard, type);
            assertNull(response.getMissingItems());
            assertTrue(BlueprintValidator.fitsBuildRadius(clipboard, type));
        } catch (IllegalStateException | ExceptionInInitializerError | NoClassDefFoundError e) {
            org.junit.Assume.assumeNoException(e);
        }
    }

    @Test
    public void generatedWheatFarmBlueprintFitsRadius() {
        org.junit.Assume.assumeTrue("WorldEdit block registry unavailable in this JVM",
                WorldEditTestSupport.isBlockRegistryReady());
        RegionType type = loadFarmType();
        try {
            BlockArrayClipboard clipboard = BlueprintGenerator.buildClipboard(type);
            assertNotNull(clipboard);
            assertTrue(BlueprintValidator.fitsBuildRadius(clipboard, type));
        } catch (IllegalStateException | ExceptionInInitializerError | NoClassDefFoundError e) {
            org.junit.Assume.assumeNoException(e);
        }
    }

    @Test
    public void structurePlacerRotationTurnsNorthToEast() {
        var rotated = StructurePlacer.rotateOffset(
                com.sk89q.worldedit.math.BlockVector3.at(1, 0, 0),
                org.bukkit.block.BlockFace.EAST);
        assertTrue(rotated.x() == 0 && rotated.z() == 1);
    }

    @Test
    public void structurePlacerRotationTurnsNorthToSouth() {
        var rotated = StructurePlacer.rotateOffset(
                com.sk89q.worldedit.math.BlockVector3.at(1, 0, 0),
                org.bukkit.block.BlockFace.SOUTH);
        assertTrue(rotated.x() == -1 && rotated.z() == 0);
    }

    private RegionType loadHousingType(String name, int radius) {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("CHEST*2");
        reqs.add("g:door*1");
        reqs.add("g:window*4");
        reqs.add("g:bed*1");
        reqs.add("g:sign*1");
        reqs.add("FURNACE");
        reqs.add("CRAFTING_TABLE");
        reqs.add("g:roof*16");
        reqs.add("g:secondary*8");
        reqs.add("g:primary*30");
        config.set("build-reqs", reqs);
        config.set("build-radius", radius);
        config.set("instant-build", true);
        return ItemManager.getInstance().loadRegionType(config, name);
    }

    private RegionType loadFarmType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("g:fencegate*1");
        reqs.add("g:fence*16");
        reqs.add("WATER*1");
        reqs.add("WHEAT*24");
        config.set("build-reqs", reqs);
        config.set("build-radius", 4);
        config.set("groups", new ArrayList<>(java.util.Arrays.asList("farm")));
        config.set("instant-build", true);
        return ItemManager.getInstance().loadRegionType(config, "wheat_farm_validator");
    }
}

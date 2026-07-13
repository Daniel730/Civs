package org.redcastlemedia.multitallented.civs.regions.placement;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class PlacementSystemTests extends TestUtil {

    @Before
    public void setup() {
        ItemManager.getInstance();
    }

    @Test
    public void placementSessionExpires() throws Exception {
        RegionType type = loadShackType();
        PlacementSession session = new PlacementSession(new Location(world, 0, 64, 0), type,
                org.bukkit.block.BlockFace.NORTH);
        java.lang.reflect.Field field = PlacementSession.class.getDeclaredField("createdAt");
        field.setAccessible(true);
        field.setLong(session, System.currentTimeMillis() - 120_000L);
        assertTrue(session.isExpired());
    }

    @Test
    public void regionTypeLoadsInstantBuildFields() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("build-reqs", List.of("CHEST*2", "g:door*1"));
        config.set("build-radius", 3);
        config.set("instant-build", true);
        config.set("blueprint", "custom.schem");
        RegionType type = ItemManager.getInstance().loadRegionType(config, "test_shack");
        assertTrue(type.isInstantBuild());
        assertTrue(type.getResolvedBlueprintFile().endsWith("custom.schem"));
    }

    @Test
    public void generatedBlueprintFitsBuildRadius() {
        org.junit.Assume.assumeTrue("WorldEdit block registry unavailable in this JVM",
                WorldEditTestSupport.isBlockRegistryReady());
        RegionType type = loadShackType();
        BlockArrayClipboard clipboard = BlueprintGenerator.buildClipboard(type);
        assertNotNull(clipboard);
        assertTrue(BlueprintValidator.fitsBuildRadius(clipboard, type));
    }

    @Test
    public void terrainFoundationYUsesAverageWhenFlattening() {
        Location center = new Location(world, 100, 64, 100);
        int y = TerrainAdapter.computeFoundationY(center, 2, true);
        assertTrue(y >= world.getMinHeight());
    }

    private RegionType loadShackType() {
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
        config.set("build-radius", 3);
        config.set("instant-build", true);
        return ItemManager.getInstance().loadRegionType(config, "shack_test");
    }
}

package org.redcastlemedia.multitallented.civs.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.effects.ForSaleEffect;
import org.redcastlemedia.multitallented.civs.util.Constants;

/**
 * Serialization round-trip + resilience tests for {@link RegionManager}'s per-region YAML
 * persistence (the private {@code saveRegionToFile} / {@code loadRegion} pair). Covers:
 * a full save→load field round-trip, tolerance of missing optional fields, and graceful
 * null returns for invalid/corrupt data instead of throwing.
 */
public class RegionSerializationTest extends TestUtil {

    private static Method saveMethod;
    private static Method loadMethod;
    private File dir;

    @Before
    public void setup() throws Exception {
        saveMethod = RegionManager.class.getDeclaredMethod(
                "saveRegionToFile", Region.class, File.class, boolean.class);
        saveMethod.setAccessible(true);
        loadMethod = RegionManager.class.getDeclaredMethod("loadRegion", File.class);
        loadMethod.setAccessible(true);
        dir = Files.createTempDirectory("civs-region-ser").toFile();
    }

    private void save(Region region, File file) throws Exception {
        saveMethod.invoke(null, region, file, false); // sync write
    }

    private Region load(File file) throws Exception {
        return (Region) loadMethod.invoke(RegionManager.getInstance(), file);
    }

    private RegionType loadType() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("icon", "CHEST");
        config.set("name", "ser_test_region");
        config.set("effects", List.of(ForSaleEffect.KEY));
        ItemManager.getInstance().loadRegionType(config, "ser_test_region");
        return (RegionType) ItemManager.getInstance().getItemType("ser_test_region");
    }

    private Region newRegion(int[] radii) {
        RegionType type = loadType();
        HashMap<UUID, String> people = new HashMap<>();
        people.put(player.getUniqueId(), Constants.OWNER);
        Location location = new Location(TestUtil.world, 100, 64, 100);
        @SuppressWarnings("unchecked")
        HashMap<String, String> effects = (HashMap<String, String>) type.getEffects().clone();
        return new Region(type.getProcessedName(), people, location, radii, effects, 0);
    }

    @Test
    public void fullRoundTripPreservesFields() throws Exception {
        Region region = newRegion(new int[] {2, 6, 1, 5, 4, 3}); // distinct radii to catch mapping bugs
        region.setForSale(250);
        region.setExp(12.5);
        region.setDisplayName("My Base");
        region.setWarehouseEnabled(false);
        region.getEffects().put("conveyor", "up");
        region.getChests().add("world~1~2~3");

        File file = new File(dir, region.getId() + ".yml");
        save(region, file);
        assertTrue("save must produce a file", file.exists());

        Region loaded = load(file);
        assertNotNull("round-trip must load a region", loaded);
        assertEquals(region.getType(), loaded.getType());
        assertEquals(region.getRadiusXP(), loaded.getRadiusXP());
        assertEquals(region.getRadiusXN(), loaded.getRadiusXN());
        assertEquals(region.getRadiusYP(), loaded.getRadiusYP());
        assertEquals(region.getRadiusYN(), loaded.getRadiusYN());
        assertEquals(region.getRadiusZP(), loaded.getRadiusZP());
        assertEquals(region.getRadiusZN(), loaded.getRadiusZN());
        assertEquals(250, loaded.getForSale(), 0.001);
        assertEquals(12.5, loaded.getExp(), 0.001);
        assertEquals("My Base", loaded.getDisplayName());
        assertEquals(false, loaded.isWarehouseEnabled());
        assertEquals("up", loaded.getEffects().get("conveyor"));
        assertTrue(loaded.getChests().contains("world~1~2~3"));
        assertTrue(loaded.getPeople().containsKey(player.getUniqueId()));
    }

    @Test
    public void loadToleratesMissingOptionalFields() throws Exception {
        // Minimal valid region: only required identity/type/radii; optional fields absent.
        Region region = newRegion(new int[] {3, 3, 3, 3, 3, 3});
        File file = new File(dir, region.getId() + ".yml");
        save(region, file);

        Region loaded = load(file);
        assertNotNull(loaded);
        assertEquals(-1, loaded.getForSale(), 0.001);      // default: not for sale
        assertNull(loaded.getDisplayName());                // no display name set
        assertTrue(loaded.isWarehouseEnabled());            // defaults to true
    }

    @Test
    public void corruptYamlReturnsNullInsteadOfThrowing() throws Exception {
        File file = new File(dir, "corrupt.yml");
        Files.writeString(file.toPath(), "this: is: not: valid: yaml: [unterminated");
        assertNull(load(file));
    }

    @Test
    public void invalidLocationReturnsNull() throws Exception {
        // Valid YAML but a location referencing an unknown world -> invalid region -> null.
        File file = new File(dir, "invalid.yml");
        YamlConfiguration config = new YamlConfiguration();
        config.set("location", UUID.randomUUID() + "~10~64~10"); // unknown world uuid
        config.set("type", "ser_test_region");
        config.set("xp-radius", 3);
        config.set("xn-radius", 3);
        config.set("yp-radius", 3);
        config.set("yn-radius", 3);
        config.set("zp-radius", 3);
        config.set("zn-radius", 3);
        loadType();
        config.save(file);
        assertNull(load(file));
    }
}

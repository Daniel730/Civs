package org.redcastlemedia.multitallented.civs.regions;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.AfterClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.junit.runners.Parameterized.Parameter;
import org.junit.runners.Parameterized.Parameters;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;

/**
 * Data-driven "every structure works" test. Loads every {@code type: region}
 * definition from the authoritative server config pack ({@code Civs_servidor/item-types})
 * and asserts each one loads into a valid {@link RegionType} on Paper 26.1.2 without any
 * material falling back to STONE (which {@code CVItem} does, with a SEVERE log, for
 * materials that were renamed/removed between Minecraft versions — the classic thing that
 * silently "breaks" a structure after a migration).
 *
 * <p>Each region type becomes its own test case, so the run reports a pass/fail per
 * structure. See {@code scripts/structure_report.sh} for a human-readable inventory.
 */
@RunWith(Parameterized.class)
public class ServerPackRegionTypesTest extends TestUtil {

    private static final File ITEM_TYPES_DIR = new File("Civs_servidor/item-types");

    @Parameter(0)
    public String structureName;

    @Parameter(1)
    public File file;

    /**
     * This test loads the production server-pack region types into the shared
     * {@link ItemManager} singleton (overwriting the test config-set types of the same
     * name). Restore canonical test state afterwards so later test classes are not
     * polluted (the singletons carry state across tests).
     */
    @AfterClass
    public static void restoreItemTypes() {
        ItemManager.getInstance().reload();
    }

    @Parameters(name = "{0}")
    public static Collection<Object[]> data() throws IOException {
        assertTrue("Server pack item-types dir missing: " + ITEM_TYPES_DIR.getAbsolutePath(),
                ITEM_TYPES_DIR.isDirectory());
        List<Object[]> params = new ArrayList<>();
        try (Stream<Path> paths = Files.walk(ITEM_TYPES_DIR.toPath())) {
            List<Path> ymls = paths.filter(p -> p.toString().endsWith(".yml"))
                    .sorted()
                    .collect(Collectors.toList());
            for (Path p : ymls) {
                String content = Files.readString(p);
                boolean isRegion = content.lines().anyMatch(l -> l.trim().equals("type: region"));
                if (!isRegion) {
                    continue;
                }
                String name = p.getFileName().toString().replace(".yml", "");
                params.add(new Object[] { name, p.toFile() });
            }
        }
        assertTrue("Expected many region structures, found " + params.size(), params.size() >= 150);
        return params;
    }

    @Test
    public void regionTypeLoadsWithAllMaterialsResolvedOnPaper() throws Exception {
        YamlConfiguration config = YamlConfiguration.loadConfiguration(file);

        // Capture Civs' "Unknown material ... falling back to STONE" SEVERE logs during load.
        Logger original = Civs.logger;
        List<String> logs = new ArrayList<>();
        Logger capturing = Logger.getLogger("structure-test-" + structureName);
        capturing.setUseParentHandlers(false);
        capturing.setLevel(Level.ALL);
        Handler handler = new Handler() {
            @Override public void publish(LogRecord record) {
                if (record.getMessage() != null) {
                    logs.add(record.getMessage());
                }
            }
            @Override public void flush() { }
            @Override public void close() { }
        };
        capturing.addHandler(handler);

        RegionType regionType;
        try {
            Civs.logger = capturing;
            regionType = ItemManager.getInstance().loadRegionType(config, structureName);
        } catch (Exception e) {
            throw new AssertionError("Structure '" + structureName + "' threw while loading: " + e, e);
        } finally {
            Civs.logger = original;
        }

        assertNotNull("Structure '" + structureName + "' failed to load (null RegionType)", regionType);

        List<String> unknownMaterials = logs.stream()
                .filter(m -> m.contains("Unknown material"))
                .collect(Collectors.toList());
        if (!unknownMaterials.isEmpty()) {
            fail("Structure '" + structureName + "' references material(s) invalid on Paper 26.1.2:\n  "
                    + String.join("\n  ", unknownMaterials));
        }
    }
}

package org.redcastlemedia.multitallented.civs.regions.placement;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;

import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardFormat;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardFormats;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardReader;

@CivsSingleton
public class BlueprintManager {
    private static BlueprintManager instance;
    private final Map<String, Clipboard> cache = new HashMap<>();
    private File blueprintsDir;

    public static BlueprintManager getInstance() {
        if (instance == null) {
            instance = new BlueprintManager();
        }
        return instance;
    }

    public void init() {
        blueprintsDir = new File(Civs.dataLocation, "blueprints");
        if (!blueprintsDir.exists()) {
            blueprintsDir.mkdirs();
        }
        copyBundledBlueprints();
        ensureGeneratedBlueprints();
    }

    public boolean isWorldEditAvailable() {
        if (Civs.getInstance() == null) {
            return false;
        }
        return Civs.getInstance().getServer().getPluginManager().isPluginEnabled("WorldEdit")
                || Civs.getInstance().getServer().getPluginManager().isPluginEnabled("FastAsyncWorldEdit");
    }

    public boolean hasBlueprint(RegionType regionType) {
        if (!isWorldEditAvailable()) {
            return false;
        }
        return getBlueprintFile(regionType).exists();
    }

    public Clipboard getClipboard(RegionType regionType) {
        String key = regionType.getProcessedName().toLowerCase();
        if (cache.containsKey(key)) {
            return cache.get(key);
        }
        File file = getBlueprintFile(regionType);
        if (!file.exists()) {
            return null;
        }
        ClipboardFormat format = ClipboardFormats.findByFile(file);
        if (format == null) {
            Civs.logger.warning("Unknown schematic format for " + file.getName());
            return null;
        }
        try (InputStream in = new FileInputStream(file);
             ClipboardReader reader = format.getReader(in)) {
            Clipboard clipboard = reader.read();
            cache.put(key, clipboard);
            return clipboard;
        } catch (IOException e) {
            Civs.logger.log(Level.SEVERE, "Failed to load blueprint " + file.getName(), e);
            return null;
        }
    }

    public File getBlueprintFile(RegionType regionType) {
        return new File(blueprintsDir, regionType.getResolvedBlueprintFile());
    }

    public void invalidateCache(String regionTypeName) {
        cache.remove(regionTypeName.toLowerCase());
    }

    private File getBlueprintFile(String fileName) {
        return new File(blueprintsDir, fileName);
    }

    private void copyBundledBlueprints() {
        String resourcePrefix = "/resources/" + ConfigManager.getInstance().getDefaultConfigSet() + "/blueprints/";
        String[] bundled = {
                "shack.schem", "hovel.schem", "dwelling.schem", "house.schem", "chalet.schem",
                "mansion.schem", "manor.schem", "villa.schem", "estate.schem", "SOURCES.md"
        };
        for (String name : bundled) {
            if (name.endsWith(".schem")) {
                File dest = getBlueprintFile(name);
                if (dest.exists()) {
                    continue;
                }
            }
            try (InputStream in = BlueprintManager.class.getResourceAsStream(resourcePrefix + name)) {
                if (in == null) {
                    continue;
                }
                File dest = getBlueprintFile(name);
                if (!dest.exists()) {
                    java.nio.file.Files.copy(in, dest.toPath());
                }
            } catch (IOException e) {
                Civs.logger.log(Level.WARNING, "Unable to copy bundled blueprint " + name, e);
            }
        }
    }

    private void ensureGeneratedBlueprints() {
        if (!isWorldEditRuntimeReady()) {
            return;
        }
        for (CivItem item : ItemManager.getInstance().getAllItemTypes().values()) {
            if (!(item instanceof RegionType regionType) || !regionType.isInstantBuild()
                    || regionType.getGroups() == null || !regionType.getGroups().contains("housing")) {
                continue;
            }
            File dest = getBlueprintFile(regionType.getResolvedBlueprintFile());
            if (!dest.exists()) {
                BlueprintGenerator.generateIfMissing(regionType.getProcessedName(), dest);
            }
        }
    }

    private boolean isWorldEditRuntimeReady() {
        try {
            com.sk89q.worldedit.world.block.BlockTypes.OAK_PLANKS.getDefaultState();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}

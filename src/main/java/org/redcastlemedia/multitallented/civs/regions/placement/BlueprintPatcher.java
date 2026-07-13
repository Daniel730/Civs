package org.redcastlemedia.multitallented.civs.regions.placement;

import org.redcastlemedia.multitallented.civs.regions.placement.BlueprintGenerator;
import org.redcastlemedia.multitallented.civs.regions.placement.BlueprintValidator;

/**
 * Ensures downloaded or generated schematics satisfy Civs build requirements.
 * Fallback blueprints are generated at runtime when bundled files are absent.
 */
public final class BlueprintPatcher {

    private BlueprintPatcher() {
    }

    public static boolean ensureValid(org.redcastlemedia.multitallented.civs.regions.RegionType regionType,
                                      java.io.File schematicFile) {
        var clipboard = BlueprintGenerator.buildClipboard(regionType);
        var validation = BlueprintValidator.validateClipboard(clipboard, regionType);
        if (validation.getMissingItems() != null) {
            return false;
        }
        try {
            schematicFile.getParentFile().mkdirs();
            try (var writer = com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC
                    .getWriter(new java.io.FileOutputStream(schematicFile))) {
                writer.write(clipboard);
            }
            BlueprintManager.getInstance().invalidateCache(regionType.getProcessedName());
            return true;
        } catch (java.io.IOException e) {
            return false;
        }
    }
}

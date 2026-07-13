package org.redcastlemedia.multitallented.civs.regions.placement;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

public final class TerrainAdapter {

    private TerrainAdapter() {
    }

    public static class TerrainChange {
        private final Location location;
        private final Material previous;

        public TerrainChange(Location location, Material previous) {
            this.location = location.clone();
            this.previous = previous;
        }

        public void rollback() {
            location.getBlock().setType(previous, false);
        }
    }

    public static List<TerrainChange> prepareTerrain(Location center, RegionType regionType) {
        ConfigManager config = ConfigManager.getInstance();
        List<TerrainChange> changes = new ArrayList<>();
        if (!config.isInstantBuildEnabled()) {
            return changes;
        }
        int radius = regionType.getBuildRadiusX();
        int foundationY = computeFoundationY(center, radius, config.isInstantBuildFlattenFoundation());
        Material fill = config.getInstantBuildFoundationBlock();

        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                Location columnBase = center.clone().add(x, 0, z);
                int surfaceY = columnBase.getWorld().getHighestBlockYAt(columnBase);
                int targetY = config.isInstantBuildFlattenFoundation() ? foundationY : surfaceY;

                if (config.isInstantBuildFillHoles()) {
                    for (int y = center.getWorld().getMinHeight(); y < targetY; y++) {
                        Location loc = center.clone().add(x, y - center.getBlockY(), z);
                        Block block = loc.getBlock();
                        if (block.getType().isAir() || block.isLiquid()) {
                            changes.add(new TerrainChange(loc, block.getType()));
                            block.setType(fill, false);
                        }
                    }
                }

                Location foundation = center.clone().add(x, targetY - center.getBlockY(), z);
                Block foundationBlock = foundation.getBlock();
                if (foundationBlock.getType().isAir() || foundationBlock.isLiquid()) {
                    changes.add(new TerrainChange(foundation, foundationBlock.getType()));
                    foundationBlock.setType(fill, false);
                }
            }
        }
        return changes;
    }

    public static void rollback(List<TerrainChange> changes) {
        for (int i = changes.size() - 1; i >= 0; i--) {
            changes.get(i).rollback();
        }
    }

    static int computeFoundationY(Location center, int radius, boolean flatten) {
        if (!flatten) {
            return center.getBlockY();
        }
        int sum = 0;
        int count = 0;
        for (int x = -radius; x <= radius; x++) {
            for (int z = -radius; z <= radius; z++) {
                Location loc = center.clone().add(x, 0, z);
                sum += loc.getWorld().getHighestBlockYAt(loc);
                count++;
            }
        }
        return count == 0 ? center.getBlockY() : Math.round((float) sum / count);
    }
}

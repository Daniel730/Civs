package org.redcastlemedia.multitallented.civs.regions;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.items.CVInventory;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.items.UnloadedInventoryHandler;

/**
 * Farm regions use the icon (center) chest for tools/reagents/inputs and a separate
 * structure chest for outputs when one is available inside the build radius.
 */
public final class RegionChestUtil {

    private RegionChestUtil() {
    }

    public static boolean isFarmRegion(Region region) {
        if (region == null) {
            return false;
        }
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        return regionType != null && regionType.getGroups().contains("farm");
    }

    public static CVInventory getInputChest(Region region) {
        return UnloadedInventoryHandler.getInstance().getChestInventory(region.getLocation());
    }

    public static CVInventory findOutputChest(Region region, ItemStack... outputs) {
        if (!isFarmRegion(region)) {
            return getInputChest(region);
        }
        Location center = region.getLocation();
        List<Location> chestLocations = findChestLocations(region);
        if (chestLocations.isEmpty()) {
            return null;
        }

        Location inputBlock = center.getBlock().getLocation();
        List<Location> outputCandidates = new ArrayList<>();
        for (Location chestLocation : chestLocations) {
            if (!sameBlock(inputBlock, chestLocation)) {
                outputCandidates.add(chestLocation);
            }
        }
        if (outputCandidates.isEmpty()) {
            outputCandidates.add(inputBlock);
        }

        outputCandidates.sort(Comparator.comparingDouble(loc -> loc.distanceSquared(center)));

        CVInventory fallback = null;
        for (Location candidate : outputCandidates) {
            CVInventory inventory = UnloadedInventoryHandler.getInstance().getChestInventory(candidate);
            if (!inventory.isValid()) {
                continue;
            }
            if (fallback == null) {
                fallback = inventory;
            }
            if (outputs == null || outputs.length == 0 || inventory.checkAddItems(outputs).isEmpty()) {
                return inventory;
            }
        }
        return fallback;
    }

    public static List<Location> findChestLocations(Region region) {
        List<Location> chests = new ArrayList<>();
        Location center = region.getLocation();
        if (center.getWorld() == null) {
            return chests;
        }
        Block centerBlock = center.getBlock();
        if (centerBlock != null && centerBlock.getType() == Material.CHEST) {
            chests.add(centerBlock.getLocation());
        }

        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        if (regionType == null) {
            return chests;
        }

        double lx = Math.floor(center.getX()) + 0.5;
        double ly = Math.floor(center.getY()) + 0.5;
        double lz = Math.floor(center.getZ()) + 0.5;
        double buildRadius = regionType.getBuildRadius();

        int xMin = (int) Math.round(lx - buildRadius);
        int yMin = Math.max((int) Math.round(ly - buildRadius), center.getWorld().getMinHeight());
        int zMin = (int) Math.round(lz - buildRadius);
        int xMax = (int) Math.round(lx + buildRadius);
        int yMax = Math.min((int) Math.round(ly + buildRadius), center.getWorld().getMaxHeight() - 1);
        int zMax = (int) Math.round(lz + buildRadius);

        World world = center.getWorld();
        for (int x = xMin; x < xMax; x++) {
            for (int y = yMin; y < yMax; y++) {
                for (int z = zMin; z < zMax; z++) {
                    Block block = world.getBlockAt(x, y, z);
                    if (block == null || block.getType() != Material.CHEST) {
                        continue;
                    }
                    Location blockLocation = block.getLocation();
                    boolean duplicate = false;
                    for (Location existing : chests) {
                        if (sameBlock(existing, blockLocation)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        chests.add(blockLocation);
                    }
                }
            }
        }
        return chests;
    }

    private static boolean sameBlock(Location a, Location b) {
        return a.getWorld().equals(b.getWorld())
                && a.getBlockX() == b.getBlockX()
                && a.getBlockY() == b.getBlockY()
                && a.getBlockZ() == b.getBlockZ();
    }
}

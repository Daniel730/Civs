package org.redcastlemedia.multitallented.civs.regions;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.redcastlemedia.multitallented.civs.items.CVInventory;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.items.UnloadedInventoryHandler;
import org.redcastlemedia.multitallented.civs.util.Util;

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
        if (centerBlock != null && isFarmDepositChest(centerBlock.getType())) {
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
        for (int x = xMin; x <= xMax; x++) {
            for (int y = yMin; y <= yMax; y++) {
                for (int z = zMin; z <= zMax; z++) {
                    Block block = world.getBlockAt(x, y, z);
                    if (block == null || !isFarmDepositChest(block.getType())) {
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

    private static boolean isFarmDepositChest(Material material) {
        return material == Material.CHEST || material == Material.TRAPPED_CHEST;
    }

    private static boolean sameBlock(Location a, Location b) {
        return a.getWorld().equals(b.getWorld())
                && a.getBlockX() == b.getBlockX()
                && a.getBlockY() == b.getBlockY()
                && a.getBlockZ() == b.getBlockZ();
    }

    /** Lowest remaining durability % among required tools in the input chest (-1 if none required). */
    public static int getLowestToolDurabilityPercent(Region region) {
        if (!isFarmRegion(region)) {
            return -1;
        }
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        if (regionType == null) {
            return -1;
        }
        CVInventory chest = getInputChest(region);
        if (chest == null || !chest.isValid()) {
            return -1;
        }
        int lowestPercent = 100;
        boolean found = false;
        for (RegionUpkeep upkeep : regionType.getUpkeeps()) {
            List<List<CVItem>> toolReqs = Util.mergeToolRequirements(upkeep.getReagents(), upkeep.getTools());
            for (List<CVItem> orGroup : toolReqs) {
                for (CVItem req : orGroup) {
                    int maxDurability = req.getMat().getMaxDurability();
                    if (maxDurability <= 0) {
                        continue;
                    }
                    int bestRemaining = 0;
                    for (ItemStack stack : chest.getContents()) {
                        if (stack == null || !(stack.getItemMeta() instanceof Damageable damageable)) {
                            continue;
                        }
                        if (req.equivalentItem(stack, req.getDisplayName() != null, !req.getLore().isEmpty())) {
                            bestRemaining = Math.max(bestRemaining, maxDurability - damageable.getDamage());
                        }
                    }
                    if (bestRemaining == 0) {
                        return 0;
                    }
                    found = true;
                    int percent = (int) Math.round(100.0 * bestRemaining / maxDurability);
                    lowestPercent = Math.min(lowestPercent, percent);
                }
            }
        }
        return found ? lowestPercent : -1;
    }

    /** Material names still missing from the input chest for failing upkeep cycles. */
    public static List<String> summarizeMissingUpkeepMaterials(Region region, RegionType regionType) {
        List<String> missing = new ArrayList<>();
        if (region == null || regionType == null || region.getFailingUpkeeps().isEmpty()) {
            return missing;
        }
        CVInventory chest = getInputChest(region);
        if (chest == null || !chest.isValid()) {
            missing.add("CHEST");
            return missing;
        }
        for (Integer index : region.getFailingUpkeeps()) {
            if (index >= regionType.getUpkeeps().size()) {
                continue;
            }
            RegionUpkeep upkeep = regionType.getUpkeeps().get(index);
            List<List<CVItem>> consumables = Util.consumableReagents(upkeep.getReagents());
            if (!consumables.isEmpty() && !Util.containsItems(consumables, chest)) {
                missing.add(labelFirstMaterial(consumables));
            }
            List<List<CVItem>> tools = Util.mergeToolRequirements(upkeep.getReagents(), upkeep.getTools());
            if (!tools.isEmpty() && !Util.containsTools(tools, chest)) {
                missing.add(labelFirstMaterial(tools));
            }
            if (!upkeep.getInputs().isEmpty() && !Util.containsItems(upkeep.getInputs(), chest)) {
                missing.add(labelFirstMaterial(upkeep.getInputs()));
            }
        }
        return missing;
    }

    private static String labelFirstMaterial(List<List<CVItem>> groups) {
        if (groups == null || groups.isEmpty() || groups.get(0).isEmpty()) {
            return "?";
        }
        return groups.get(0).get(0).getMat().name();
    }
}

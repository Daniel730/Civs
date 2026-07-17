package org.redcastlemedia.multitallented.civs.regions;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.DoubleChest;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Restricts what can be deposited into a region's input (icon/center) chest to
 * materials accepted by that region's upkeep tools, reagents, and inputs.
 * Output chests are not filtered (any overflow deposit destination).
 */
public final class RegionInputChestFilter {

    private RegionInputChestFilter() {
    }

    /**
     * If {@code inventory} is a region's input chest, returns that region; otherwise null.
     * Nearby farm output chests are excluded.
     */
    public static Region resolveInputRegion(Inventory inventory) {
        if (inventory == null) {
            return null;
        }
        Location location = inventoryLocation(inventory);
        if (location == null) {
            return null;
        }
        Region region = RegionManager.getInstance().getRegionAt(location);
        if (region == null) {
            return null;
        }
        Location inputLoc = region.getLocation().getBlock().getLocation();
        if (!sameBlock(inputLoc, location.getBlock().getLocation())) {
            // Opening a double chest that includes the input block still counts.
            if (!inventoryTouchesInput(inventory, inputLoc)) {
                return null;
            }
        }
        return region;
    }

    public static boolean isAllowedInInput(Region region, ItemStack stack) {
        if (region == null || stack == null || stack.getType() == Material.AIR || stack.getAmount() <= 0) {
            return true;
        }
        Set<Material> allowed = getAllowedInputMaterials(region);
        if (allowed.isEmpty()) {
            // No upkeep consumables configured — do not block (e.g. pure command regions).
            return true;
        }
        return allowed.contains(stack.getType());
    }

    public static Set<Material> getAllowedInputMaterials(Region region) {
        Set<Material> allowed = new HashSet<>();
        if (region == null) {
            return allowed;
        }
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        if (regionType == null) {
            return allowed;
        }
        for (RegionUpkeep upkeep : regionType.getUpkeeps()) {
            addMaterials(allowed, Util.consumableReagents(upkeep.getReagents()));
            addMaterials(allowed, Util.mergeToolRequirements(upkeep.getReagents(), upkeep.getTools()));
            addMaterials(allowed, upkeep.getInputs());
        }
        return allowed;
    }

    private static void addMaterials(Set<Material> into, List<List<CVItem>> groups) {
        if (groups == null) {
            return;
        }
        for (List<CVItem> orGroup : groups) {
            if (orGroup == null) {
                continue;
            }
            for (CVItem item : orGroup) {
                if (item != null && item.getMat() != null && item.getMat() != Material.AIR) {
                    into.add(item.getMat());
                }
            }
        }
    }

    private static Location inventoryLocation(Inventory inventory) {
        try {
            Location loc = inventory.getLocation();
            if (loc != null) {
                return loc;
            }
        } catch (Exception ignored) {
            // some holders throw
        }
        InventoryHolder holder = inventory.getHolder();
        if (holder instanceof DoubleChest doubleChest) {
            InventoryHolder left = doubleChest.getLeftSide();
            if (left instanceof Chest chest) {
                return chest.getLocation();
            }
        }
        if (holder instanceof Chest chest) {
            return chest.getLocation();
        }
        if (holder instanceof Block block) {
            return block.getLocation();
        }
        return null;
    }

    private static boolean inventoryTouchesInput(Inventory inventory, Location inputLoc) {
        InventoryHolder holder = inventory.getHolder();
        if (!(holder instanceof DoubleChest doubleChest)) {
            return false;
        }
        InventoryHolder left = doubleChest.getLeftSide();
        InventoryHolder right = doubleChest.getRightSide();
        if (left instanceof Chest leftChest && sameBlock(leftChest.getLocation().getBlock().getLocation(), inputLoc)) {
            return true;
        }
        return right instanceof Chest rightChest
                && sameBlock(rightChest.getLocation().getBlock().getLocation(), inputLoc);
    }

    private static boolean sameBlock(Location a, Location b) {
        if (a == null || b == null || a.getWorld() == null || b.getWorld() == null) {
            return false;
        }
        return a.getWorld().equals(b.getWorld())
                && a.getBlockX() == b.getBlockX()
                && a.getBlockY() == b.getBlockY()
                && a.getBlockZ() == b.getBlockZ();
    }

    public static String formatAllowedHint(Set<Material> allowed) {
        if (allowed == null || allowed.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        int i = 0;
        for (Material mat : allowed) {
            if (i++ > 0) {
                sb.append(", ");
            }
            if (i > 6) {
                sb.append("…");
                break;
            }
            sb.append(mat.name().toLowerCase(Locale.ROOT).replace('_', ' '));
        }
        return sb.toString();
    }
}

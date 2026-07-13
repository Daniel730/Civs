package org.redcastlemedia.multitallented.civs.regions.placement;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

public final class InventoryRequirementChecker {

    private InventoryRequirementChecker() {
    }

    public static List<HashMap<Material, Integer>> getMissingMaterials(Player player, RegionType regionType) {
        List<HashMap<Material, Integer>> itemCheck = Region.cloneReqMap(regionType.getReqs());
        countInventoryMaterials(player, itemCheck);
        return collectUnmetGroups(itemCheck);
    }

    public static boolean hasMaterials(Player player, RegionType regionType) {
        return getMissingMaterials(player, regionType).isEmpty();
    }

    public static boolean consumeMaterials(Player player, RegionType regionType) {
        if (!hasMaterials(player, regionType)) {
            return false;
        }
        for (List<org.redcastlemedia.multitallented.civs.items.CVItem> group : regionType.getReqs()) {
            HashMap<Material, Integer> needed = new HashMap<>();
            for (org.redcastlemedia.multitallented.civs.items.CVItem cvItem : group) {
                needed.put(cvItem.getMat(), cvItem.getQty());
            }
            Material chosen = chooseMaterialForGroup(player, needed);
            if (chosen == null) {
                return false;
            }
            int qty = needed.get(chosen);
            if (!removeAmount(player, chosen, qty)) {
                return false;
            }
        }
        return true;
    }

    private static List<HashMap<Material, Integer>> collectUnmetGroups(List<HashMap<Material, Integer>> itemCheck) {
        List<HashMap<Material, Integer>> missing = new java.util.ArrayList<>();
        for (HashMap<Material, Integer> group : itemCheck) {
            HashMap<Material, Integer> stillNeeded = new HashMap<>();
            for (Map.Entry<Material, Integer> entry : group.entrySet()) {
                if (entry.getValue() > 0) {
                    stillNeeded.put(entry.getKey(), entry.getValue());
                }
            }
            if (!stillNeeded.isEmpty()) {
                missing.add(stillNeeded);
            }
        }
        return missing;
    }

    private static void countInventoryMaterials(Player player, List<HashMap<Material, Integer>> itemCheck) {
        for (ItemStack stack : player.getInventory().getContents()) {
            if (stack == null || stack.getType() == Material.AIR) {
                continue;
            }
            Material mat = stack.getType();
            int amount = stack.getAmount();
            for (HashMap<Material, Integer> group : itemCheck) {
                Material matched = Region.findMatchingReqMaterial(mat, group);
                if (matched != null && group.get(matched) > 0) {
                    int use = Math.min(amount, group.get(matched));
                    for (Material key : group.keySet()) {
                        group.put(key, group.get(key) - use);
                    }
                    amount -= use;
                    if (amount <= 0) {
                        break;
                    }
                }
            }
        }
    }

    private static Material chooseMaterialForGroup(Player player, HashMap<Material, Integer> group) {
        for (ItemStack stack : player.getInventory().getContents()) {
            if (stack == null || stack.getType() == Material.AIR) {
                continue;
            }
            Material matched = Region.findMatchingReqMaterial(stack.getType(), group);
            if (matched != null && stack.getAmount() >= group.get(matched)) {
                return matched;
            }
        }
        return null;
    }

    private static boolean removeAmount(Player player, Material reqMat, int amount) {
        int remaining = amount;
        for (int slot = 0; slot < player.getInventory().getSize() && remaining > 0; slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (stack == null || stack.getType() == Material.AIR) {
                continue;
            }
            if (!Region.matchesBuildReqMaterial(stack.getType(), reqMat)) {
                continue;
            }
            int take = Math.min(remaining, stack.getAmount());
            remaining -= take;
            stack.setAmount(stack.getAmount() - take);
            if (stack.getAmount() <= 0) {
                player.getInventory().setItem(slot, null);
            }
        }
        return remaining <= 0;
    }
}

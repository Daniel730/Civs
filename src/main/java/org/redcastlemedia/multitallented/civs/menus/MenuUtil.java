package org.redcastlemedia.multitallented.civs.menus;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;

import com.google.common.base.Enums;

public final class MenuUtil {
    private MenuUtil() {

    }
    public static Material toItemMaterial(Material mat) {
        if (mat == Material.REDSTONE_WIRE) {
            return Material.REDSTONE;
        } else if (mat == Material.WATER) {
            return Material.WATER_BUCKET;
        } else if (mat == Material.CAULDRON || mat == Enums.getIfPresent(Material.class, "WATER_CAULDRON").orNull()) {
            return Material.WATER_BUCKET;
        } else if (mat == Material.LAVA) {
            return Material.LAVA_BUCKET;
        } else if (mat == Material.POTATOES) {
            return Material.POTATO;
        } else if (mat == Material.CARROTS) {
            return Material.CARROT;
        } else if (mat == Material.OAK_WALL_SIGN) {
            return Material.OAK_SIGN;
        } else if (mat == Material.BIRCH_WALL_SIGN) {
            return Material.BIRCH_SIGN;
        } else if (mat == Material.DARK_OAK_WALL_SIGN) {
            return Material.DARK_OAK_SIGN;
        } else if (mat == Material.SPRUCE_WALL_SIGN) {
            return Material.SPRUCE_SIGN;
        } else if (mat == Material.JUNGLE_WALL_SIGN) {
            return Material.JUNGLE_SIGN;
        } else if (mat == Material.ACACIA_WALL_SIGN) {
            return Material.ACACIA_SIGN;
        } else if (mat == Enums.getIfPresent(Material.class, "CHERRY_WALL_SIGN").orNull()) {
            return Enums.getIfPresent(Material.class, "CHERRY_SIGN").or(Material.ACACIA_SIGN);
        } else if (mat == Material.COCOA) {
            return Material.COCOA_BEANS;
        }
        return mat;
    }

    public static void sanitizeItem(ItemStack item) {
        Material mat = item.getType();
        if (mat == Material.RED_BED || mat == Material.BLACK_BED || mat == Material.BLUE_BED
                || mat == Material.BROWN_BED || mat == Material.CYAN_BED
                || mat == Material.GRAY_BED || mat == Material.GREEN_BED || mat == Material.LIGHT_BLUE_BED
                || mat == Material.LIGHT_GRAY_BED || mat == Material.LIME_BED || mat == Material.MAGENTA_BED
                || mat == Material.ORANGE_BED || mat == Material.PINK_BED || mat == Material.PURPLE_BED
                || mat == Material.WHITE_BED || mat == Material.YELLOW_BED) {
            divideByTwo(item);
        } else if (mat == Material.OAK_DOOR || mat == Material.IRON_DOOR || mat == Material.DARK_OAK_DOOR
                || mat == Material.BIRCH_DOOR || mat == Material.ACACIA_DOOR || mat == Material.SPRUCE_DOOR
                || mat == Material.JUNGLE_DOOR || mat == Enums.getIfPresent(Material.class, "CHERRY_DOOR").orNull()) {
            divideByTwo(item);
        } else {
            Material itemMat = toItemMaterial(mat);
            if (itemMat != mat) {
                item.setType(itemMat);
            }
        }
    }
    private static void divideByTwo(ItemStack item) {
        if (item.getAmount() > 1) {
            item.setAmount((int) Math.round((double) item.getAmount() / 2));
        }
    }

    public static int getInventorySize(int count) {
        int size = 9;
        if (count > size) {
            size = count + 9 - (count % 9);
            if (count % 9 == 0) {
                size -= 9;
            }
        }
        return Math.min(size, 54);
    }
}

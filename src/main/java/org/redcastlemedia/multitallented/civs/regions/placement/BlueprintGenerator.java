package org.redcastlemedia.multitallented.civs.regions.placement;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.logging.Level;

import org.bukkit.Material;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.extent.clipboard.io.ClipboardWriter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import com.sk89q.worldedit.world.block.BaseBlock;
import com.sk89q.worldedit.world.block.BlockTypes;

public final class BlueprintGenerator {

    private BlueprintGenerator() {
    }

    public static void generateIfMissing(String regionTypeName, File dest) {
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(regionTypeName);
        if (regionType == null) {
            return;
        }
        try {
            BlockArrayClipboard clipboard = buildClipboard(regionType);
            dest.getParentFile().mkdirs();
            try (ClipboardWriter writer = BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getWriter(new FileOutputStream(dest))) {
                writer.write(clipboard);
            }
            BlueprintManager.getInstance().invalidateCache(regionTypeName);
            Civs.logger.info("Generated fallback blueprint: " + dest.getName());
        } catch (IOException | RuntimeException e) {
            Civs.logger.log(Level.WARNING, "Failed to generate blueprint for " + regionTypeName, e);
        } catch (RuntimeException e) {
            Civs.logger.log(Level.WARNING, "Failed to generate blueprint for " + regionTypeName + ": " + e.getMessage());
        }
    }

    static BlockArrayClipboard buildClipboard(RegionType regionType) {
        try {
            return buildClipboardInternal(regionType);
        } catch (IllegalStateException | ExceptionInInitializerError e) {
            throw new IllegalStateException("WorldEdit not initialized for blueprint generation", e);
        }
    }

    private static BlockArrayClipboard buildClipboardInternal(RegionType regionType) {
        if (regionType.getGroups() != null && regionType.getGroups().contains("farm")) {
            return buildFarmClipboard(regionType);
        }
        int radius = regionType.getBuildRadiusX();
        int height = Math.max(5, regionType.getBuildRadiusY() * 2);
        BlockVector3 min = BlockVector3.at(-radius, 0, -radius);
        BlockVector3 max = BlockVector3.at(radius, height, radius);
        CuboidRegion region = new CuboidRegion(min, max);
        BlockArrayClipboard clipboard = new BlockArrayClipboard(region);
        clipboard.setOrigin(BlockVector3.ZERO);

        BaseBlock primary = BlockTypes.OAK_PLANKS.getDefaultState().toBaseBlock();
        BaseBlock secondary = BlockTypes.COBBLESTONE.getDefaultState().toBaseBlock();
        BaseBlock roof = BlockTypes.OAK_STAIRS.getDefaultState().toBaseBlock();
        BaseBlock air = BlockTypes.AIR.getDefaultState().toBaseBlock();

        Map<Material, Integer> targets = countTargets(regionType);

        for (BlockVector3 pos : region) {
            int x = pos.x();
            int y = pos.y();
            int z = pos.z();
            if (y == 0) {
                clipboard.setBlock(pos, secondary);
                continue;
            }
            boolean outerWall = Math.abs(x) == radius || Math.abs(z) == radius;
            boolean innerSpace = Math.abs(x) < radius && Math.abs(z) < radius;
            if (y == height && innerSpace) {
                clipboard.setBlock(pos, roof);
            } else if (outerWall && y < height) {
                clipboard.setBlock(pos, y % 2 == 0 ? primary : secondary);
            } else if (innerSpace && y < height) {
                clipboard.setBlock(pos, air);
            }
        }

        placeFunctionalBlocks(clipboard, targets);
        fillRemainingCounts(clipboard, region, targets, primary, secondary, roof);
        return clipboard;
    }

    private static Map<Material, Integer> countTargets(RegionType regionType) {
        Map<Material, Integer> targets = new HashMap<>();
        for (List<CVItem> group : regionType.getReqs()) {
            for (CVItem item : group) {
                targets.merge(item.getMat(), item.getQty(), Integer::sum);
            }
        }
        return targets;
    }

    private static void placeFunctionalBlocks(BlockArrayClipboard clipboard, Map<Material, Integer> targets) {
        setAndDecrement(clipboard, BlockVector3.ZERO, Material.CHEST, targets);
        setAndDecrement(clipboard, BlockVector3.at(1, 1, 0), Material.FURNACE, targets);
        setAndDecrement(clipboard, BlockVector3.at(-1, 1, 0), Material.CRAFTING_TABLE, targets);
        setAndDecrement(clipboard, BlockVector3.at(0, 1, 1), Material.RED_BED, targets);
        setAndDecrement(clipboard, BlockVector3.at(0, 2, 0), Material.OAK_SIGN, targets);
        setAndDecrement(clipboard, BlockVector3.at(0, 1, -1), Material.OAK_DOOR, targets);
        int windowZ = 2;
        for (int i = 0; i < 6; i++) {
            if (getRemaining(targets, Material.GLASS_PANE) <= 0
                    && getRemaining(targets, Material.GLASS) <= 0) {
                break;
            }
            Material windowMat = getRemaining(targets, Material.GLASS_PANE) > 0
                    ? Material.GLASS_PANE : Material.GLASS;
            setAndDecrement(clipboard, BlockVector3.at(i % 2 == 0 ? 2 : -2, 2, windowZ), windowMat, targets);
            windowZ++;
        }
        while (getRemaining(targets, Material.CHEST) > 0) {
            setAndDecrement(clipboard, BlockVector3.at(2, 1, 0), Material.CHEST, targets);
        }
        while (getRemaining(targets, Material.FURNACE) > 0) {
            setAndDecrement(clipboard, BlockVector3.at(2, 1, 1), Material.FURNACE, targets);
        }
    }

    private static void fillRemainingCounts(BlockArrayClipboard clipboard, CuboidRegion region,
                                            Map<Material, Integer> targets,
                                            BaseBlock primary, BaseBlock secondary, BaseBlock roof) {
        for (BlockVector3 pos : region) {
            if (clipboard.getBlock(pos).getBlockType().getMaterial().isAir()) {
                continue;
            }
            if (getRemaining(targets, Material.OAK_PLANKS) > 0
                    || getRemaining(targets, Material.OAK_WOOD) > 0) {
                decrementAnyPrimary(targets);
                clipboard.setBlock(pos, primary);
            } else if (getRemaining(targets, Material.COBBLESTONE) > 0) {
                decrementAnySecondary(targets);
                clipboard.setBlock(pos, secondary);
            } else if (getRemaining(targets, Material.OAK_STAIRS) > 0
                    || getRemaining(targets, Material.OAK_SLAB) > 0) {
                decrementAnyRoof(targets);
                clipboard.setBlock(pos, roof);
            }
        }
    }

    private static int getRemaining(Map<Material, Integer> targets, Material mat) {
        return targets.getOrDefault(mat, 0);
    }

    private static void setAndDecrement(BlockArrayClipboard clipboard, BlockVector3 pos,
                                        Material mat, Map<Material, Integer> targets) {
        if (getRemaining(targets, mat) <= 0) {
            return;
        }
        var blockType = blockTypeForMaterial(mat);
        if (blockType != null) {
            clipboard.setBlock(pos, blockType.getDefaultState().toBaseBlock());
            targets.put(mat, targets.get(mat) - 1);
        }
    }

    private static com.sk89q.worldedit.world.block.BlockType blockTypeForMaterial(Material mat) {
        return BlockTypes.get(mat.name().toLowerCase(Locale.ROOT));
    }

    private static void decrementAnyPrimary(Map<Material, Integer> targets) {
        for (Material mat : List.of(Material.OAK_PLANKS, Material.SPRUCE_PLANKS, Material.BIRCH_PLANKS)) {
            if (targets.getOrDefault(mat, 0) > 0) {
                targets.put(mat, targets.get(mat) - 1);
                return;
            }
        }
    }

    private static void decrementAnySecondary(Map<Material, Integer> targets) {
        if (targets.getOrDefault(Material.COBBLESTONE, 0) > 0) {
            targets.put(Material.COBBLESTONE, targets.get(Material.COBBLESTONE) - 1);
        }
    }

    private static void decrementAnyRoof(Map<Material, Integer> targets) {
        if (targets.getOrDefault(Material.OAK_STAIRS, 0) > 0) {
            targets.put(Material.OAK_STAIRS, targets.get(Material.OAK_STAIRS) - 1);
        } else if (targets.getOrDefault(Material.OAK_SLAB, 0) > 0) {
            targets.put(Material.OAK_SLAB, targets.get(Material.OAK_SLAB) - 1);
        }
    }

    private static BlockArrayClipboard buildFarmClipboard(RegionType regionType) {
        int radius = regionType.getBuildRadiusX();
        BlockVector3 min = BlockVector3.at(-radius, 0, -radius);
        BlockVector3 max = BlockVector3.at(radius, 2, radius);
        CuboidRegion region = new CuboidRegion(min, max);
        BlockArrayClipboard clipboard = new BlockArrayClipboard(region);
        clipboard.setOrigin(BlockVector3.ZERO);

        BaseBlock dirt = BlockTypes.DIRT.getDefaultState().toBaseBlock();
        BaseBlock farmland = BlockTypes.FARMLAND.getDefaultState().toBaseBlock();
        BaseBlock fence = BlockTypes.OAK_FENCE.getDefaultState().toBaseBlock();
        BaseBlock fenceGate = BlockTypes.OAK_FENCE_GATE.getDefaultState().toBaseBlock();
        BaseBlock water = BlockTypes.WATER.getDefaultState().toBaseBlock();
        BaseBlock air = BlockTypes.AIR.getDefaultState().toBaseBlock();
        BaseBlock primary = BlockTypes.OAK_PLANKS.getDefaultState().toBaseBlock();

        Map<Material, Integer> targets = countTargets(regionType);

        for (BlockVector3 pos : region) {
            int x = pos.x();
            int z = pos.z();
            int y = pos.y();
            boolean perimeter = Math.abs(x) == radius || Math.abs(z) == radius;
            if (y == 0) {
                clipboard.setBlock(pos, dirt);
            } else if (y == 1 && perimeter) {
                if (x == 0 && z == -radius && getRemaining(targets, Material.OAK_FENCE_GATE) > 0) {
                    clipboard.setBlock(pos, fenceGate);
                    targets.put(Material.OAK_FENCE_GATE, targets.get(Material.OAK_FENCE_GATE) - 1);
                } else if (getRemaining(targets, Material.OAK_FENCE) > 0
                        || getRemaining(targets, Material.SPRUCE_FENCE) > 0) {
                    clipboard.setBlock(pos, fence);
                    decrementFence(targets);
                } else {
                    clipboard.setBlock(pos, primary);
                    decrementAnyPrimary(targets);
                }
            } else if (y == 1) {
                clipboard.setBlock(pos, air);
            } else if (y == 2 && !perimeter) {
                Material crop = pickCropMaterial(targets);
                if (crop != null) {
                    var blockType = blockTypeForMaterial(crop);
                    if (blockType != null) {
                        clipboard.setBlock(pos, blockType.getDefaultState().toBaseBlock());
                        targets.put(crop, targets.get(crop) - 1);
                    }
                } else if (getRemaining(targets, Material.WATER) > 0) {
                    clipboard.setBlock(pos, water);
                    targets.put(Material.WATER, targets.get(Material.WATER) - 1);
                } else if (getRemaining(targets, Material.FARMLAND) > 0) {
                    clipboard.setBlock(pos, farmland);
                    targets.put(Material.FARMLAND, targets.get(Material.FARMLAND) - 1);
                } else {
                    clipboard.setBlock(pos, primary);
                    decrementAnyPrimary(targets);
                }
            }
        }

        setAndDecrement(clipboard, BlockVector3.ZERO, Material.CHEST, targets);
        fillRemainingCounts(clipboard, region, targets, primary,
                BlockTypes.COBBLESTONE.getDefaultState().toBaseBlock(),
                BlockTypes.OAK_STAIRS.getDefaultState().toBaseBlock());
        return clipboard;
    }

    private static void decrementFence(Map<Material, Integer> targets) {
        for (Material mat : List.of(Material.OAK_FENCE, Material.SPRUCE_FENCE, Material.BIRCH_FENCE)) {
            if (targets.getOrDefault(mat, 0) > 0) {
                targets.put(mat, targets.get(mat) - 1);
                return;
            }
        }
    }

    private static Material pickCropMaterial(Map<Material, Integer> targets) {
        for (Material mat : List.of(Material.WHEAT, Material.CARROTS, Material.POTATOES, Material.BEETROOTS,
                Material.MELON, Material.PUMPKIN, Material.CACTUS, Material.SUGAR_CANE, Material.COCOA,
                Material.BROWN_MUSHROOM, Material.RED_MUSHROOM, Material.DANDELION, Material.POPPY,
                Material.BLUE_ORCHID, Material.ALLIUM, Material.AZURE_BLUET, Material.RED_TULIP,
                Material.ORANGE_TULIP, Material.WHITE_TULIP, Material.PINK_TULIP, Material.OXEYE_DAISY)) {
            if (targets.getOrDefault(mat, 0) > 0) {
                return mat;
            }
        }
        return null;
    }
}

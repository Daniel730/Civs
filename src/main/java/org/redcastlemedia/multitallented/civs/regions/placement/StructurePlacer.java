package org.redcastlemedia.multitallented.civs.regions.placement;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.BlockFace;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.EditSession;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.function.operation.Operation;
import com.sk89q.worldedit.function.operation.Operations;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.math.transform.AffineTransform;
import com.sk89q.worldedit.session.ClipboardHolder;

public final class StructurePlacer {

    private StructurePlacer() {
    }

    public static boolean pasteStructure(Location center, RegionType regionType, BlockFace facing) {
        if (!BlueprintManager.getInstance().isWorldEditAvailable()) {
            return false;
        }
        Clipboard clipboard = BlueprintManager.getInstance().getClipboard(regionType);
        if (clipboard == null) {
            return false;
        }
        World world = center.getWorld();
        if (world == null) {
            return false;
        }
        BlockVector3 to = BlockVector3.at(center.getBlockX(), center.getBlockY(), center.getBlockZ());
        try {
            if (tryFawePaste(world, clipboard, to, facing)) {
                return true;
            }
            return pasteSync(world, clipboard, to, facing);
        } catch (Exception e) {
            Civs.logger.severe("Structure paste failed for " + regionType.getProcessedName() + ": " + e.getMessage());
            return false;
        }
    }

    private static boolean pasteSync(World world, Clipboard clipboard, BlockVector3 to, BlockFace facing)
            throws Exception {
        try (EditSession editSession = WorldEdit.getInstance().newEditSession(BukkitAdapter.adapt(world))) {
            ClipboardHolder holder = new ClipboardHolder(clipboard);
            holder.setTransform(buildRotationTransform(facing));
            Operation operation = holder.createPaste(editSession)
                    .to(to)
                    .ignoreAirBlocks(false)
                    .build();
            Operations.complete(operation);
            return true;
        }
    }

    /**
     * Uses FAWE's EditSessionBuilder when FastAsyncWorldEdit is present (async batched paste).
     * Falls back to {@link #pasteSync} when reflection fails or FAWE is absent.
     */
    private static boolean tryFawePaste(World world, Clipboard clipboard, BlockVector3 to, BlockFace facing) {
        if (Civs.getInstance() == null
                || !Civs.getInstance().getServer().getPluginManager().isPluginEnabled("FastAsyncWorldEdit")) {
            return false;
        }
        com.sk89q.worldedit.world.World weWorld = BukkitAdapter.adapt(world);
        EditSession editSession = null;
        try {
            Class<?> builderClass = Class.forName("com.fastasyncworldedit.core.extent.processor.EditSessionBuilder");
            Object builder = builderClass.getConstructor(com.sk89q.worldedit.world.World.class).newInstance(weWorld);
            builderClass.getMethod("fastmode", boolean.class).invoke(builder, true);
            builderClass.getMethod("checkMemory", boolean.class).invoke(builder, false);
            editSession = (EditSession) builderClass.getMethod("build").invoke(builder);

            ClipboardHolder holder = new ClipboardHolder(clipboard);
            holder.setTransform(buildRotationTransform(facing));
            Operation operation = holder.createPaste(editSession)
                    .to(to)
                    .ignoreAirBlocks(false)
                    .build();
            Operations.complete(operation);
            return true;
        } catch (ReflectiveOperationException e) {
            return false;
        } catch (Exception e) {
            Civs.logger.warning("FAWE paste failed, falling back to sync WorldEdit: " + e.getMessage());
            return false;
        } finally {
            if (editSession != null) {
                editSession.close();
            }
        }
    }

    static AffineTransform buildRotationTransform(BlockFace facing) {
        AffineTransform transform = new AffineTransform();
        int rotations = facingToQuarterTurns(facing);
        for (int i = 0; i < rotations; i++) {
            transform = transform.rotateY(-90);
        }
        return transform;
    }

    static BlockVector3 rotateOffset(BlockVector3 offset, BlockFace facing) {
        int x = offset.x();
        int z = offset.z();
        int rotations = facingToQuarterTurns(facing);
        for (int i = 0; i < rotations; i++) {
            int newX = -z;
            int newZ = x;
            x = newX;
            z = newZ;
        }
        return BlockVector3.at(x, offset.y(), z);
    }

    private static int facingToQuarterTurns(BlockFace facing) {
        return switch (facing) {
            case EAST -> 1;
            case SOUTH -> 2;
            case WEST -> 3;
            default -> 0;
        };
    }
}

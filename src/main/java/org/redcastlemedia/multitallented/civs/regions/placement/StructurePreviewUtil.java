package org.redcastlemedia.multitallented.civs.regions.placement;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.regions.StructureUtil;

import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.world.block.BlockState;

public final class StructurePreviewUtil {
    private static final long PREVIEW_DURATION = 30_000L;
    private static final Map<UUID, PreviewSession> previews = new HashMap<>();

    private StructurePreviewUtil() {
    }

    public static void showPreview(Player player, PlacementSession session) {
        removePreview(player.getUniqueId());
        Clipboard clipboard = BlueprintManager.getInstance().getClipboard(session.getRegionType());
        if (clipboard == null) {
            StructureUtil.showGuideBoundingBox(player, session.getTarget(), session.getRegionType(), false);
            return;
        }
        Location center = session.getTarget();
        PreviewSession previewSession = new PreviewSession(player.getUniqueId(), center.clone());
        previews.put(player.getUniqueId(), previewSession);

        BlockVector3 origin = clipboard.getOrigin();
        for (BlockVector3 pos : clipboard.getRegion()) {
            BlockState state = clipboard.getBlock(pos);
            if (state.getBlockType().getMaterial().isAir()) {
                continue;
            }
            BlockVector3 relative = pos.subtract(origin);
            BlockVector3 turned = StructurePlacer.rotateOffset(relative, session.getFacing());
            Location worldLoc = center.clone().add(turned.x(), turned.y(), turned.z());
            Material previewMat = pickPreviewMaterial(state);
            player.sendBlockChange(worldLoc, previewMat.createBlockData());
            previewSession.locations.add(worldLoc);
        }

        Bukkit.getScheduler().runTaskLater(Civs.getInstance(),
                () -> removePreview(player.getUniqueId()), PREVIEW_DURATION / 50L);
    }

    public static void removePreview(UUID playerId) {
        PreviewSession session = previews.remove(playerId);
        if (session == null) {
            return;
        }
        Player player = Bukkit.getPlayer(playerId);
        if (player == null || !player.isOnline()) {
            return;
        }
        for (Location loc : session.locations) {
            player.sendBlockChange(loc, loc.getBlock().getBlockData());
        }
    }

    private static Material pickPreviewMaterial(BlockState state) {
        Material mat = Material.matchMaterial(state.getBlockType().getId());
        if (mat == null || mat.isAir()) {
            return Material.LIGHT_BLUE_STAINED_GLASS;
        }
        return Material.LIGHT_BLUE_STAINED_GLASS;
    }

    private static final class PreviewSession {
        private final UUID playerId;
        private final Location center;
        private final HashSet<Location> locations = new HashSet<>();

        private PreviewSession(UUID playerId, Location center) {
            this.playerId = playerId;
            this.center = center;
        }
    }
}

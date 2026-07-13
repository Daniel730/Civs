package org.redcastlemedia.multitallented.civs.regions.placement;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionBlockCheckResponse;
import org.redcastlemedia.multitallented.civs.regions.RegionPoints;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.world.block.BlockState;

public final class BlueprintValidator {

    private BlueprintValidator() {
    }

    public static RegionBlockCheckResponse validateClipboard(Clipboard clipboard, RegionType regionType) {
        List<HashMap<Material, Integer>> itemCheck = Region.cloneReqMap(regionType.getReqs());
        BlockVector3 origin = clipboard.getOrigin();
        for (BlockVector3 pos : clipboard.getRegion()) {
            BlockState state = clipboard.getBlock(pos);
            if (state.getBlockType().getMaterial().isAir()) {
                continue;
            }
            Material mat = Material.matchMaterial(state.getBlockType().getId());
            if (mat == null) {
                continue;
            }
            consumeMaterial(itemCheck, mat);
            if (itemCheck.isEmpty()) {
                break;
            }
        }
        if (!itemCheck.isEmpty()) {
            return new RegionBlockCheckResponse(new RegionPoints(), itemCheck);
        }
        RegionPoints points = new RegionPoints(regionType.getBuildRadiusX(), regionType.getBuildRadiusX(),
                regionType.getBuildRadiusY(), regionType.getBuildRadiusY(),
                regionType.getBuildRadiusZ(), regionType.getBuildRadiusZ());
        return new RegionBlockCheckResponse(points, null);
    }

    public static boolean fitsBuildRadius(Clipboard clipboard, RegionType regionType) {
        BlockVector3 dim = clipboard.getDimensions();
        int maxHorizontal = Math.max(dim.x(), dim.z());
        int allowed = regionType.getBuildRadiusX() * 2 + 1;
        return maxHorizontal <= allowed + 2 && dim.y() <= regionType.getBuildRadiusY() * 2 + 3;
    }

    public static RegionBlockCheckResponse validateAtLocation(World world, Location center, RegionType regionType) {
        return Region.hasRequiredBlocksOnCenter(regionType, center);
    }

    private static void consumeMaterial(List<HashMap<Material, Integer>> itemCheck, Material mat) {
        for (var it = itemCheck.iterator(); it.hasNext(); ) {
            HashMap<Material, Integer> tempMap = it.next();
            Material groupReq = Region.findMatchingReqMaterial(mat, tempMap);
            if (groupReq != null) {
                if (tempMap.get(groupReq) < 2) {
                    it.remove();
                } else {
                    for (Material currentMat : tempMap.keySet()) {
                        tempMap.put(currentMat, tempMap.get(groupReq) - 1);
                    }
                }
                return;
            }
        }
    }
}

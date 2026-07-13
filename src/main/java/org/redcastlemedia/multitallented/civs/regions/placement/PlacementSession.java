package org.redcastlemedia.multitallented.civs.regions.placement;

import lombok.Getter;
import lombok.Setter;
import org.bukkit.Location;
import org.bukkit.block.BlockFace;
import org.redcastlemedia.multitallented.civs.regions.RegionType;

@Getter
@Setter
public class PlacementSession {
    private static final long TTL_MS = 60_000L;

    private final Location target;
    private final RegionType regionType;
    private final BlockFace facing;
    private final long createdAt;
    private PlacementMode mode = PlacementMode.UNSET;
    private boolean rebuildTransition;
    private Location rebuildLocation;

    public PlacementSession(Location target, RegionType regionType, BlockFace facing) {
        this.target = target.clone();
        this.regionType = regionType;
        this.facing = facing != null ? facing : BlockFace.NORTH;
        this.createdAt = System.currentTimeMillis();
    }

    public boolean isExpired() {
        return System.currentTimeMillis() - createdAt > TTL_MS;
    }
}

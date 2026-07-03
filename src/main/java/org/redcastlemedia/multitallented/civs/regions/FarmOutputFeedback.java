package org.redcastlemedia.multitallented.civs.regions;

import org.bukkit.Location;
import org.bukkit.Particle;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Optional particles above farm output chests when items are deposited.
 */
public final class FarmOutputFeedback {

    private FarmOutputFeedback() {
    }

    public static void onDeposit(Region region, Location outputLocation) {
        if (region == null || outputLocation == null
                || !ConfigManager.getInstance().isFarmOutputParticles()
                || !RegionChestUtil.isFarmRegion(region)) {
            return;
        }
        if (!Util.isLocationWithinSightOfPlayer(outputLocation)) {
            return;
        }
        Location above = outputLocation.clone().add(0.5, 1.1, 0.5);
        above.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, above, 3, 0.15, 0.1, 0.15, 0);
    }
}

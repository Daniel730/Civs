package org.redcastlemedia.multitallented.civs.regions.effects;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.events.RegionUpkeepEvent;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.mobs.CustomMobManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Region effect stub: {@code custom_mob:bandit_chief} spawns a YAML-defined mob on upkeep tick.
 */
@CivsSingleton
public class CustomMobSpawnEffect implements Listener {

    public static final String KEY = "custom_mob";

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new CustomMobSpawnEffect(), Civs.getInstance());
    }

    @EventHandler(ignoreCancelled = true)
    public void onUpkeep(RegionUpkeepEvent event) {
        if (!CustomMobManager.getInstance().isEnabled()) {
            return;
        }
        if (!event.getRegion().getEffects().containsKey(KEY)) {
            return;
        }
        Location location = event.getRegion().getLocation();
        if (!Util.isLocationWithinSightOfPlayer(location)) {
            return;
        }
        String mobId = event.getRegion().getEffects().get(KEY);
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(event.getRegion().getType());
        int radius = Math.max(regionType.getEffectRadius(), regionType.getBuildRadius());
        if (location.getWorld().getNearbyEntities(location, radius, radius, radius).size() > 5) {
            return;
        }
        Location spawnLocation = new Location(location.getWorld(), location.getX(), location.getY() + 1, location.getZ());
        LivingEntity spawned = CustomMobManager.getInstance().spawn(mobId, spawnLocation);
        if (spawned == null) {
            Civs.logger.warning("custom_mob region effect could not spawn mob '" + mobId + "' for "
                    + event.getRegion().getType());
        }
    }
}

package org.redcastlemedia.multitallented.civs.regions.effects;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.events.RegionUpkeepEvent;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.mobs.CustomMobManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Region effect: {@code custom_mob:bandit_scout} spawns a YAML mob on upkeep when few entities nearby.
 * Vars = mob id from {@code plugins/Civs/mobs/*.yml}. Omit {@code despawn-seconds} in mob YAML to keep until killed.
 * Per-region cooldown: {@code custom-mob-region-spawn-cooldown-seconds} in config.yml.
 * Example region: {@code item-types/defense/bandit_camp.yml}.
 */
@CivsSingleton
public class CustomMobSpawnEffect implements Listener {

    public static final String KEY = "custom_mob";

    private static final Map<String, Long> lastSpawnByRegion = new ConcurrentHashMap<>();

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
        long cooldownMs = ConfigManager.getInstance().getCustomMobRegionSpawnCooldownSeconds() * 1000L;
        String regionKey = event.getRegion().getId();
        Long lastSpawn = lastSpawnByRegion.get(regionKey);
        if (lastSpawn != null && System.currentTimeMillis() - lastSpawn < cooldownMs) {
            return;
        }
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
            return;
        }
        lastSpawnByRegion.put(regionKey, System.currentTimeMillis());
        announceSpawn(mobId, spawned.getLocation());
    }

    private void announceSpawn(String mobId, Location location) {
        var definition = CustomMobManager.getInstance().getMob(mobId);
        if (definition == null || location.getWorld() == null) {
            return;
        }
        String world = location.getWorld().getName();
        for (Player player : location.getWorld().getPlayers()) {
            if (player.getLocation().distanceSquared(location) > 64 * 64) {
                continue;
            }
            String display = LocaleManager.getInstance().getTranslation(player, definition.getDisplay());
            player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                    .getTranslation(player, "custom-mob-region-spawn")
                    .replace("$1", display)
                    .replace("$2", world)
                    .replace("$3", String.valueOf(location.getBlockX()))
                    .replace("$4", String.valueOf(location.getBlockY()))
                    .replace("$5", String.valueOf(location.getBlockZ())));
        }
    }
}

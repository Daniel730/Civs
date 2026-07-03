package org.redcastlemedia.multitallented.civs.regions.effects;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionEffectConstants;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownType;
import org.redcastlemedia.multitallented.civs.util.Util;

import java.util.Set;

@CivsSingleton
public class PowerShieldEffect implements Listener {

    public static final String KEY = RegionEffectConstants.POWER_SHIELD;

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new PowerShieldEffect(), Civs.getInstance());
    }

    private static boolean shieldsEnabled() {
        return ConfigManager.getInstance().isUseShields();
    }

    @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
    public void onEntityDamage(EntityDamageEvent event) {
        if (!shieldsEnabled() || event.getDamage() <= 0) {
            return;
        }
        if (!(event.getEntity() instanceof Player)) {
            return;
        }
        Player player = (Player) event.getEntity();
        if (player.getGameMode() != GameMode.SURVIVAL && player.getGameMode() != GameMode.ADVENTURE) {
            return;
        }
        if (Util.isDisallowedByWorld(player.getWorld().getName())) {
            return;
        }

        int reduction = findBestReductionPercent(player);
        if (reduction <= 0) {
            return;
        }

        double original = event.getDamage();
        double scaled = original * (100 - reduction) / 100.0;
        double absorbed = original - scaled;
        event.setDamage(Math.max(0, scaled));
        if (absorbed > 0.01) {
            ShieldFeedback.notify(player, absorbed);
        }
    }

    static int findBestReductionPercent(Player player) {
        Location location = player.getLocation();
        int best = 0;

        RegionManager regionManager = RegionManager.getInstance();
        Set<Region> regions = regionManager.getRegionEffectsAt(location, 0);
        for (Region region : regions) {
            int regionReduction = reductionFromRegion(region);
            if (regionReduction > best) {
                best = regionReduction;
            }
        }

        int townReduction = reductionFromTown(location);
        return Math.max(best, townReduction);
    }

    private static int reductionFromRegion(Region region) {
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        int reduction = 0;
        if (regionType != null && regionType.getShieldPercent() >= 0) {
            reduction = regionType.getShieldPercent();
        } else if (region.getEffects().containsKey(KEY)) {
            reduction = ShieldParams.parseReductionPercent(region.getEffects().get(KEY));
        }
        if (reduction <= 0) {
            return 0;
        }
        if (regionType != null && !regionType.getUpkeeps().isEmpty() && !region.runUpkeep(false)) {
            return 0;
        }
        return reduction;
    }

    private static int reductionFromTown(Location location) {
        Town town = TownManager.getInstance().getTownAt(location);
        if (town == null) {
            return 0;
        }

        TownType townType = (TownType) ItemManager.getInstance().getItemType(town.getType());
        boolean hasShield = town.getEffects().containsKey(KEY)
                || (townType != null && townType.getEffects().containsKey(KEY));
        if (!hasShield) {
            return 0;
        }

        if (town.getPower() <= 0 && !TownManager.getInstance().hasGrace(town, false)) {
            return 0;
        }

        String shieldValue = town.getEffects().get(KEY);
        if (shieldValue == null && townType != null) {
            shieldValue = townType.getEffects().get(KEY);
        }

        int reduction;
        if (shieldValue == null || shieldValue.isEmpty()) {
            reduction = ConfigManager.getInstance().getDefaultTownShieldReduction();
        } else {
            reduction = ShieldParams.parseReductionPercent(shieldValue);
            if (reduction > 0 && reduction < 5) {
                reduction = ConfigManager.getInstance().getDefaultTownShieldReduction();
            }
        }
        return ShieldParams.clampPercent(reduction);
    }
}

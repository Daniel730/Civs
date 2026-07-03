package org.redcastlemedia.multitallented.civs.stats;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsSingleton
public class StatListener implements Listener {

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new StatListener(), Civs.getInstance());
    }

    @EventHandler(ignoreCancelled = true, priority = EventPriority.NORMAL)
    public void onEntityDamage(EntityDamageEvent event) {
        if (Util.isDisallowedByWorld(event.getEntity().getWorld().getName())) {
            return;
        }
        if (!(event instanceof EntityDamageByEntityEvent)) {
            return;
        }
        EntityDamageByEntityEvent damageEvent = (EntityDamageByEntityEvent) event;
        Player damager = resolveDamager(damageEvent);
        Player victim = event.getEntity() instanceof Player ? (Player) event.getEntity() : null;
        boolean applyTerritorialCombat = shouldApplyTerritorialCombatStats(damager, victim);

        if (damager != null && applyTerritorialCombat && isInFriendlyTerritory(damager, damager.getLocation())) {
            StatTotals attackTotals = StatManager.getInstance()
                    .getStatTotals(damager.getUniqueId(), TerritorialStat.ATTACK_DAMAGE);
            if (attackTotals.getAddTotal() != 0 || attackTotals.getMultiplyTotal() != 1) {
                event.setDamage(attackTotals.apply(event.getDamage()));
            }
        }
        if (victim == null || !applyTerritorialCombat) {
            return;
        }
        if (!isInFriendlyTerritory(victim, victim.getLocation())) {
            return;
        }
        StatTotals defenseTotals = StatManager.getInstance()
                .getStatTotals(victim.getUniqueId(), TerritorialStat.DAMAGE_REDUCTION);
        if (defenseTotals.getAddTotal() == 0 && defenseTotals.getMultiplyTotal() == 1) {
            return;
        }
        double reduced = Math.max(0, event.getDamage() - defenseTotals.getAddTotal());
        reduced *= defenseTotals.getMultiplyTotal();
        event.setDamage(Math.max(0, reduced));
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        StatManager.getInstance().clearPlayer(event.getPlayer().getUniqueId());
    }

    private Player resolveDamager(EntityDamageByEntityEvent event) {
        if (event.getDamager() instanceof Player) {
            return (Player) event.getDamager();
        }
        if (event.getDamager() instanceof Projectile) {
            Projectile projectile = (Projectile) event.getDamager();
            if (projectile.getShooter() instanceof Player) {
                return (Player) projectile.getShooter();
            }
        }
        return null;
    }

    public static boolean isInFriendlyTerritory(Player player, Location location) {
        if (player == null || location == null) {
            return false;
        }
        Town town = TownManager.getInstance().getTownAt(location);
        if (town != null && isTownMember(player.getUniqueId(), town)) {
            return true;
        }
        Region region = RegionManager.getInstance().getRegionAt(location);
        return region != null && region.getPeople().containsKey(player.getUniqueId());
    }

    private static boolean shouldApplyTerritorialCombatStats(Player damager, Player victim) {
        if (damager == null || victim == null) {
            return true;
        }
        Town damagerTown = TownManager.getInstance().getTownAt(damager.getLocation());
        Town victimTown = TownManager.getInstance().getTownAt(victim.getLocation());
        if (damagerTown != null && damagerTown.equals(victimTown)
                && isTownMember(damager.getUniqueId(), damagerTown)
                && isTownMember(victim.getUniqueId(), victimTown)) {
            return false;
        }
        Region damagerRegion = RegionManager.getInstance().getRegionAt(damager.getLocation());
        Region victimRegion = RegionManager.getInstance().getRegionAt(victim.getLocation());
        if (damagerRegion != null && victimRegion != null
                && damagerRegion.getId().equals(victimRegion.getId())
                && damagerRegion.getPeople().containsKey(damager.getUniqueId())
                && damagerRegion.getPeople().containsKey(victim.getUniqueId())) {
            return false;
        }
        return true;
    }

    private static boolean isTownMember(java.util.UUID playerId, Town town) {
        if (!town.getPeople().containsKey(playerId)) {
            return false;
        }
        String role = town.getPeople().get(playerId);
        return role != null &&
                !role.contains("guest") &&
                !role.contains(Constants.ALLY);
    }
}

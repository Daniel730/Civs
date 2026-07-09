package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.Bukkit;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.events.CustomMobKillEvent;

@CivsSingleton
public class CustomMobListener implements Listener {

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new CustomMobListener(), Civs.getInstance());
    }

    @EventHandler(ignoreCancelled = true)
    public void onEntityDeath(EntityDeathEvent event) {
        if (!(event.getEntity() instanceof LivingEntity living)) {
            return;
        }
        String mobId = CustomMobKeys.readMobId(living);
        if (mobId == null || mobId.isEmpty()) {
            return;
        }
        CustomMobDefinition definition = CustomMobManager.getInstance().getMob(mobId);
        if (definition != null) {
            event.getDrops().clear();
            for (ItemStack drop : CustomMobManager.getInstance().rollDrops(definition)) {
                event.getDrops().add(drop);
            }
        }
        Player killer = living.getKiller();
        CustomMobKillEvent killEvent = new CustomMobKillEvent(
                mobId, killer, living.getLocation(), CustomMobKeys.readQuestOwner(living));
        Bukkit.getPluginManager().callEvent(killEvent);
    }
}

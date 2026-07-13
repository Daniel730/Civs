package org.redcastlemedia.multitallented.civs.npc;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.events.GuideNpcInteractEvent;

import java.util.List;

@CivsSingleton
public class GuideNpcListener implements Listener {

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new GuideNpcListener(), Civs.getInstance());
    }

    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEntityEvent event) {
        if (!(event.getRightClicked() instanceof Villager villager)) {
            return;
        }
        String guideId = GuideNpcKeys.readGuideId(villager);
        if (guideId == null || guideId.isBlank()) {
            return;
        }
        event.setCancelled(true);
        GuideNpcDefinition guide = GuideNpcManager.getInstance().getGuide(guideId);
        if (guide == null) {
            return;
        }
        Player player = event.getPlayer();
        showDialog(player, guide);
        Bukkit.getPluginManager().callEvent(new GuideNpcInteractEvent(player, guide.getId(), guide.getArchetype()));
    }

    private void showDialog(Player player, GuideNpcDefinition guide) {
        player.sendMessage(Civs.getPrefix() + guide.getDisplayName());
        List<String> dialog = guide.getDialog();
        if (dialog.isEmpty()) {
            player.sendMessage("...");
            return;
        }
        for (String line : dialog) {
            player.sendMessage(line);
        }
    }
}

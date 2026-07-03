package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.util.Util;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.List;

/**
 * Dramatic spawn feedback for YAML custom mobs (particles + optional boss-bar preview).
 */
public final class MobSpawnFeedback {

    private static final String BANDIT_CHIEF_ID = "bandit_chief";

    private MobSpawnFeedback() {
    }

    public static void onSpawn(LivingEntity entity, CustomMobDefinition definition) {
        if (entity == null || definition == null) {
            return;
        }
        Location location = entity.getLocation();
        if (!Util.isLocationWithinSightOfPlayer(location)) {
            return;
        }
        if (ConfigManager.getInstance().isCustomMobSpawnParticles()) {
            spawnBurst(location);
        }
        if (BANDIT_CHIEF_ID.equalsIgnoreCase(definition.getId())
                && ConfigManager.getInstance().isCustomMobBossBarPreview()) {
            showBossBarPreview(entity, definition);
        }
    }

    private static void spawnBurst(Location location) {
        Location center = location.clone().add(0, 0.5, 0);
        center.getWorld().spawnParticle(Particle.SMOKE, center, 12, 0.35, 0.5, 0.35, 0.02);
        center.getWorld().spawnParticle(Particle.CLOUD, center, 6, 0.25, 0.35, 0.25, 0.01);
    }

    private static void showBossBarPreview(LivingEntity entity, CustomMobDefinition definition) {
        String title = LocaleManager.getInstance().getTranslation(
                ConfigManager.getInstance().getDefaultLanguage(), definition.getDisplay());
        BossBar bossBar = Bukkit.createBossBar(title, BarColor.RED, BarStyle.SOLID);
        bossBar.setProgress(1.0);

        List<Player> viewers = new ArrayList<>();
        double radius = 48;
        for (Player player : entity.getWorld().getPlayers()) {
            if (player.getLocation().distanceSquared(entity.getLocation()) <= radius * radius) {
                bossBar.addPlayer(player);
                viewers.add(player);
            }
        }
        if (viewers.isEmpty()) {
            bossBar.removeAll();
            return;
        }

        int durationSeconds = ConfigManager.getInstance().getCustomMobBossBarPreviewSeconds();
        long durationTicks = durationSeconds * 20L;
        BukkitTask updateTask = new BukkitRunnable() {
            @Override
            public void run() {
                if (!entity.isValid() || entity.isDead()) {
                    cancel();
                    bossBar.removeAll();
                    return;
                }
                double max = entity.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH).getValue();
                double progress = max > 0 ? entity.getHealth() / max : 0;
                bossBar.setProgress(Math.max(0, Math.min(1, progress)));
            }
        }.runTaskTimer(Civs.getInstance(), 0L, 10L);

        Bukkit.getScheduler().runTaskLater(Civs.getInstance(), () -> {
            updateTask.cancel();
            bossBar.removeAll();
        }, durationTicks);
    }
}

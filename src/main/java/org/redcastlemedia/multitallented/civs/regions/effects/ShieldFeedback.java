package org.redcastlemedia.multitallented.civs.regions.effects;

import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.util.ActionBarUtil;
import org.redcastlemedia.multitallented.civs.util.Util;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Throttled action-bar / particle feedback when {@link PowerShieldEffect} reduces damage.
 */
final class ShieldFeedback {

    private static final Map<UUID, Long> LAST_NOTIFY = new HashMap<>();

    private ShieldFeedback() {
    }

    static void notify(Player player, double absorbedDamage) {
        if (player == null || absorbedDamage <= 0.01) {
            return;
        }
        long cooldownMs = ConfigManager.getInstance().getShieldFeedbackCooldownSeconds() * 1000L;
        long now = System.currentTimeMillis();
        Long last = LAST_NOTIFY.get(player.getUniqueId());
        if (last != null && last + cooldownMs > now) {
            maybeParticles(player);
            return;
        }
        LAST_NOTIFY.put(player.getUniqueId(), now);

        String blocked = Util.getNumberFormat(absorbedDamage,
                CivilianManager.getInstance().getCivilian(player.getUniqueId()).getLocale());
        String message = LocaleManager.getInstance()
                .getTranslation(player, "power-shield-absorbed")
                .replace("$1", blocked);
        ActionBarUtil.sendActionBar(player, message);

        maybeParticles(player);
        if (ConfigManager.getInstance().isShieldFeedbackSound()) {
            player.playSound(player.getLocation(), Sound.ITEM_TOTEM_USE, 0.25f, 1.4f);
        }
    }

    private static void maybeParticles(Player player) {
        if (!ConfigManager.getInstance().isShieldFeedbackParticles()) {
            return;
        }
        var loc = player.getLocation().add(0, 1.0, 0);
        player.getWorld().spawnParticle(Particle.END_ROD, loc, 4, 0.25, 0.4, 0.25, 0.01);
        player.getWorld().spawnParticle(Particle.TOTEM_OF_UNDYING, loc, 2, 0.2, 0.3, 0.2, 0.02);
    }
}

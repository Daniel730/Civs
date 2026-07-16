package org.redcastlemedia.multitallented.civs.spells;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civclass.CivClass;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.spells.effects.ManaEffect;
import org.redcastlemedia.multitallented.civs.util.ActionBarUtil;

/**
 * Displays Civs mana without fighting AuraSkills / other ActionBar users when configured.
 */
public final class ManaHud {

    private static final Map<UUID, BossBar> BARS = new ConcurrentHashMap<>();

    private ManaHud() {
    }

    public static void update(Civilian civilian) {
        if (civilian == null) {
            return;
        }
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null || !player.isOnline()) {
            return;
        }
        ManaHudMode mode = ConfigManager.getInstance().getManaHudMode();
        if (mode == ManaHudMode.OFF) {
            clear(civilian.getUuid());
            return;
        }
        if (mode == ManaHudMode.WHEN_NEEDED && !shouldShowWhenNeeded(civilian)) {
            clear(civilian.getUuid());
            return;
        }

        boolean aura = isAuraSkillsPresent();
        String text = ManaEffect.getManaBar(civilian);
        if (text == null || text.isBlank()) {
            return;
        }

        if (mode.usesBossBar(aura)) {
            showBossBar(player, civilian, text);
            return;
        }
        if (mode.usesActionBar(aura)) {
            clearBossBarOnly(civilian.getUuid());
            ActionBarUtil.sendActionBar(player, text);
        }
    }

    public static void clear(UUID uuid) {
        clearBossBarOnly(uuid);
    }

    public static boolean isAuraSkillsPresent() {
        Plugin plugin = Bukkit.getPluginManager().getPlugin("AuraSkills");
        return plugin != null && plugin.isEnabled();
    }

    static boolean shouldShowWhenNeeded(Civilian civilian) {
        CivClass civClass = civilian.getCurrentClass();
        if (civClass == null) {
            return false;
        }
        if (!civilian.getCombatBar().isEmpty()) {
            return true;
        }
        return civilian.getMana() < civClass.getMaxMana();
    }

    private static void showBossBar(Player player, Civilian civilian, String coloredText) {
        CivClass civClass = civilian.getCurrentClass();
        double max = civClass != null ? Math.max(1, civClass.getMaxMana()) : 1;
        double progress = Math.max(0, Math.min(1, civilian.getMana() / max));

        BossBar bar = BARS.computeIfAbsent(player.getUniqueId(), id -> {
            BossBar created = Bukkit.createBossBar(stripColors(coloredText), BarColor.BLUE, BarStyle.SEGMENTED_10);
            created.setVisible(true);
            return created;
        });
        bar.setTitle(stripColors(coloredText));
        bar.setProgress(progress);
        bar.setColor(progress < 0.25 ? BarColor.RED : progress < 0.5 ? BarColor.YELLOW : BarColor.BLUE);
        if (!bar.getPlayers().contains(player)) {
            bar.addPlayer(player);
        }
    }

    private static void clearBossBarOnly(UUID uuid) {
        BossBar bar = BARS.remove(uuid);
        if (bar != null) {
            bar.removeAll();
            bar.setVisible(false);
        }
    }

    private static String stripColors(String input) {
        return ChatColor.stripColor(input);
    }
}

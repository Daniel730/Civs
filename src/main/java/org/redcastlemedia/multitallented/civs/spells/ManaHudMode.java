package org.redcastlemedia.multitallented.civs.spells;

import java.util.Locale;

/**
 * How Civs displays mana to players. ActionBar conflicts with AuraSkills idle HUD;
 * prefer {@link #AUTO} or {@link #BOSSBAR} on servers that run AuraSkills.
 */
public enum ManaHudMode {
    /** BossBar when AuraSkills is present, otherwise ActionBar. */
    AUTO,
    ACTIONBAR,
    BOSSBAR,
    /** Only while mana is below max or the combat spell bar is active. */
    WHEN_NEEDED,
    OFF;

    public static ManaHudMode fromConfig(String raw) {
        if (raw == null || raw.isBlank()) {
            return AUTO;
        }
        String key = raw.trim().toLowerCase(Locale.ROOT).replace('-', '_');
        return switch (key) {
            case "actionbar", "action_bar" -> ACTIONBAR;
            case "bossbar", "boss_bar" -> BOSSBAR;
            case "when_needed", "whenneeded", "combat", "needed" -> WHEN_NEEDED;
            case "off", "none", "disabled", "false" -> OFF;
            default -> AUTO;
        };
    }

    public boolean usesBossBar(boolean auraSkillsPresent) {
        return this == BOSSBAR || this == AUTO && auraSkillsPresent || this == WHEN_NEEDED && auraSkillsPresent;
    }

    public boolean usesActionBar(boolean auraSkillsPresent) {
        if (this == OFF || this == BOSSBAR) {
            return false;
        }
        if (this == ACTIONBAR) {
            return true;
        }
        // AUTO / WHEN_NEEDED without AuraSkills
        return !auraSkillsPresent;
    }
}

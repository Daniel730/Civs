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
    /**
     * External composer (e.g. RPGServer composed ActionBar) owns the HUD —
     * Civs does not send ActionBar or BossBar.
     */
    COMPOSED,
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
            case "composed", "external", "rpg", "unified" -> COMPOSED;
            case "off", "none", "disabled", "false" -> OFF;
            default -> AUTO;
        };
    }

    public boolean usesBossBar(boolean auraSkillsPresent) {
        if (this == OFF || this == COMPOSED || this == ACTIONBAR) {
            return false;
        }
        return this == BOSSBAR
                || (this == AUTO && auraSkillsPresent)
                || (this == WHEN_NEEDED && auraSkillsPresent);
    }

    public boolean usesActionBar(boolean auraSkillsPresent) {
        if (this == OFF || this == COMPOSED || this == BOSSBAR) {
            return false;
        }
        if (this == ACTIONBAR) {
            return true;
        }
        // AUTO / WHEN_NEEDED without AuraSkills
        return !auraSkillsPresent;
    }

    public boolean isExternal() {
        return this == COMPOSED || this == OFF;
    }
}

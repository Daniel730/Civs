package org.redcastlemedia.multitallented.civs.spells;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ManaHudModeTests {

    @Test
    public void fromConfigParsesKnownValues() {
        assertEquals(ManaHudMode.AUTO, ManaHudMode.fromConfig(null));
        assertEquals(ManaHudMode.AUTO, ManaHudMode.fromConfig("auto"));
        assertEquals(ManaHudMode.ACTIONBAR, ManaHudMode.fromConfig("actionbar"));
        assertEquals(ManaHudMode.ACTIONBAR, ManaHudMode.fromConfig("action-bar"));
        assertEquals(ManaHudMode.BOSSBAR, ManaHudMode.fromConfig("bossbar"));
        assertEquals(ManaHudMode.WHEN_NEEDED, ManaHudMode.fromConfig("when-needed"));
        assertEquals(ManaHudMode.WHEN_NEEDED, ManaHudMode.fromConfig("combat"));
        assertEquals(ManaHudMode.OFF, ManaHudMode.fromConfig("off"));
        assertEquals(ManaHudMode.COMPOSED, ManaHudMode.fromConfig("composed"));
        assertEquals(ManaHudMode.COMPOSED, ManaHudMode.fromConfig("external"));
    }

    @Test
    public void autoUsesBossBarOnlyWhenAuraSkillsPresent() {
        assertTrue(ManaHudMode.AUTO.usesBossBar(true));
        assertFalse(ManaHudMode.AUTO.usesActionBar(true));
        assertFalse(ManaHudMode.AUTO.usesBossBar(false));
        assertTrue(ManaHudMode.AUTO.usesActionBar(false));
    }

    @Test
    public void bossBarNeverUsesActionBar() {
        assertTrue(ManaHudMode.BOSSBAR.usesBossBar(false));
        assertFalse(ManaHudMode.BOSSBAR.usesActionBar(true));
        assertFalse(ManaHudMode.BOSSBAR.usesActionBar(false));
    }

    @Test
    public void offUsesNeitherChannel() {
        assertFalse(ManaHudMode.OFF.usesBossBar(true));
        assertFalse(ManaHudMode.OFF.usesActionBar(true));
    }

    @Test
    public void composedUsesNeitherChannel() {
        assertFalse(ManaHudMode.COMPOSED.usesBossBar(true));
        assertFalse(ManaHudMode.COMPOSED.usesActionBar(false));
        assertTrue(ManaHudMode.COMPOSED.isExternal());
    }
}

package org.redcastlemedia.multitallented.civs;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ConfigTests extends TestUtil {

    @Test
    public void useClassesAndSpellsIsHonoredFromConfig() {
        // Civs/config.yml sets use-classes-and-spells: true. Before the loadFile wiring
        // this flag was never read and stayed false, disabling the whole class/spell system.
        ConfigManager.getInstance().reload();
        assertTrue(ConfigManager.getInstance().getUseClassesAndSpells());
    }
}

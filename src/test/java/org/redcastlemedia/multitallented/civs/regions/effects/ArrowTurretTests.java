package org.redcastlemedia.multitallented.civs.regions.effects;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class ArrowTurretTests {

    @Test
    public void parseArrowTurretVars() {
        TurretParams params = TurretParams.parse("30.38.3");
        assertNotNull(params);
        assertEquals(30, params.getDamagePercent());
        assertEquals(3.8, params.getSpeed(), 0.001);
        assertEquals(3, params.getSpread());
    }

    @Test
    public void parseArrowTurretVarsDefaultsSpeedAndSpread() {
        TurretParams params = TurretParams.parse("20");
        assertNotNull(params);
        assertEquals(20, params.getDamagePercent());
        assertEquals(0.5, params.getSpeed(), 0.001);
        assertEquals(12, params.getSpread());
    }

    @Test
    public void parseArrowTurretVarsRejectsInvalid() {
        assertNull(TurretParams.parse("not-a-number"));
        assertNull(TurretParams.parse(""));
        assertNull(TurretParams.parse(null));
    }

    @Test
    public void parseDamageTurretPercent() {
        assertEquals(12, TurretParams.parseDamagePercent("12"));
        assertEquals(-1, TurretParams.parseDamagePercent("bad"));
    }
}

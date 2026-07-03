package org.redcastlemedia.multitallented.civs.regions.effects;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PowerShieldEffectTests {

    @Test
    public void parseReductionPercent() {
        assertEquals(25, ShieldParams.parseReductionPercent("25"));
        assertEquals(0, ShieldParams.parseReductionPercent("0"));
        assertEquals(100, ShieldParams.parseReductionPercent("100"));
    }

    @Test
    public void parseReductionPercentRejectsInvalid() {
        assertEquals(-1, ShieldParams.parseReductionPercent("bad"));
        assertEquals(-1, ShieldParams.parseReductionPercent(""));
        assertEquals(-1, ShieldParams.parseReductionPercent(null));
    }

    @Test
    public void clampPercent() {
        assertEquals(100, ShieldParams.clampPercent(150));
        assertEquals(0, ShieldParams.clampPercent(-5));
        assertEquals(40, ShieldParams.clampPercent(40));
        assertEquals(15, ShieldParams.clampPercent(15));
        assertEquals(25, ShieldParams.clampPercent(25));
    }
}

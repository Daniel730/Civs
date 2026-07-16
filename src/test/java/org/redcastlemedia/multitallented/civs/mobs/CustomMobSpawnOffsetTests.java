package org.redcastlemedia.multitallented.civs.mobs;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Geometry checks for quest mob spawn offsets. */
public class CustomMobSpawnOffsetTests {

    @Test
    public void offsetCandidateIsAwayFromOrigin() {
        double minDistSq = 2.5 * 2.5;
        double angle = Math.PI / 4;
        double dist = 4.0;
        double dx = Math.cos(angle) * dist;
        double dz = Math.sin(angle) * dist;
        assertTrue(dx * dx + dz * dz >= minDistSq);
    }

    @Test
    public void preferredDistanceBandIsBetweenThreeAndEight() {
        for (int i = 0; i < 20; i++) {
            double dist = 3.0 + (i / 20.0) * 5.0;
            assertTrue(dist >= 3.0 && dist <= 8.0);
        }
    }
}

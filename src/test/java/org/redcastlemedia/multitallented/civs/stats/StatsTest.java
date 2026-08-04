package org.redcastlemedia.multitallented.civs.stats;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.UUID;

import org.junit.Before;
import org.junit.Test;

/**
 * Behavioral tests for the {@code stats} package (territorial stat modifiers). This code
 * is pure logic with no Bukkit dependencies, so it is tested directly without the
 * {@code TestUtil} mock harness.
 */
public class StatsTest {

    private StatManager stats;
    private UUID player;

    @Before
    public void setup() {
        stats = StatManager.getInstance();
        player = UUID.randomUUID();
        // StatManager is a process-wide singleton; isolate by using a fresh player id and
        // clearing it (in case a previous test used the same — astronomically unlikely).
        stats.clearPlayer(player);
    }

    /** JUnit 4.12 (the pinned version) has no assertThrows; small local equivalent. */
    private static void assertThrowsIae(Runnable runnable) {
        try {
            runnable.run();
            fail("expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            // ok
        }
    }

    // ---- StatModifier validation --------------------------------------------------

    @Test
    public void modifierRejectsNullOrEmptyId() {
        assertThrowsIae(() -> new StatModifier(null, TerritorialStat.ATTACK_DAMAGE, 1, StatOperation.ADD));
        assertThrowsIae(() -> new StatModifier("", TerritorialStat.ATTACK_DAMAGE, 1, StatOperation.ADD));
    }

    @Test
    public void modifierRejectsNullStatOrOperation() {
        assertThrowsIae(() -> new StatModifier("id", null, 1, StatOperation.ADD));
        assertThrowsIae(() -> new StatModifier("id", TerritorialStat.ATTACK_DAMAGE, 1, null));
    }

    @Test
    public void modifierStoresValues() {
        StatModifier m = new StatModifier("rpg_x", TerritorialStat.SIEGE_DAMAGE, 2.5, StatOperation.MULTIPLY);
        assertEquals("rpg_x", m.getId());
        assertEquals(TerritorialStat.SIEGE_DAMAGE, m.getStat());
        assertEquals(2.5, m.getValue(), 0.0001);
        assertEquals(StatOperation.MULTIPLY, m.getOperation());
    }

    // ---- TerritorialStat parsing --------------------------------------------------

    @Test
    public void territorialStatFromKeyIsCaseInsensitiveAndNullSafe() {
        assertEquals(TerritorialStat.BUILD_SPEED, TerritorialStat.fromKey("build_speed"));
        assertEquals(TerritorialStat.BUILD_SPEED, TerritorialStat.fromKey("BUILD_SPEED"));
        assertNull(TerritorialStat.fromKey("nope"));
        assertNull(TerritorialStat.fromKey(null));
        assertNull(TerritorialStat.fromKey(""));
    }

    @Test
    public void territorialStatKeyRoundTrips() {
        for (TerritorialStat stat : TerritorialStat.values()) {
            assertEquals(stat, TerritorialStat.fromKey(stat.key()));
        }
    }

    // ---- StatTotals math ----------------------------------------------------------

    @Test
    public void statTotalsApplyAddThenMultiply() {
        assertEquals(20.0, new StatTotals(5, 2).apply(5), 0.0001); // (5+5)*2
        assertEquals(5.0, new StatTotals(0, 1).apply(5), 0.0001);  // identity
    }

    // ---- StatManager aggregation --------------------------------------------------

    @Test
    public void addAndQueryModifier() {
        stats.addModifier(player, new StatModifier("a", TerritorialStat.ATTACK_DAMAGE, 3, StatOperation.ADD));
        assertTrue(stats.hasModifier(player, "a"));
        assertEquals(1, stats.getModifiers(player).size());
        assertEquals(3, stats.getStatValue(player, TerritorialStat.ATTACK_DAMAGE), 0.0001);
    }

    @Test
    public void addTotalsSumAndMultiplyTotalsProductPerStat() {
        stats.addModifier(player, new StatModifier("a1", TerritorialStat.ATTACK_DAMAGE, 3, StatOperation.ADD));
        stats.addModifier(player, new StatModifier("a2", TerritorialStat.ATTACK_DAMAGE, 4, StatOperation.ADD));
        stats.addModifier(player, new StatModifier("m1", TerritorialStat.ATTACK_DAMAGE, 2, StatOperation.MULTIPLY));
        stats.addModifier(player, new StatModifier("m2", TerritorialStat.ATTACK_DAMAGE, 1.5, StatOperation.MULTIPLY));
        // Modifiers for a different stat must not leak in.
        stats.addModifier(player, new StatModifier("other", TerritorialStat.SHOP_DISCOUNT, 99, StatOperation.ADD));

        StatTotals totals = stats.getStatTotals(player, TerritorialStat.ATTACK_DAMAGE);
        assertEquals(7, totals.getAddTotal(), 0.0001);       // 3 + 4
        assertEquals(3, totals.getMultiplyTotal(), 0.0001);  // 2 * 1.5
        assertEquals(30, totals.apply(3), 0.0001);           // (3+7)*3
    }

    @Test
    public void addingSameIdReplacesModifier() {
        stats.addModifier(player, new StatModifier("dup", TerritorialStat.BUILD_SPEED, 1, StatOperation.ADD));
        stats.addModifier(player, new StatModifier("dup", TerritorialStat.BUILD_SPEED, 9, StatOperation.ADD));
        assertEquals(1, stats.getModifiers(player).size());
        assertEquals(9, stats.getStatValue(player, TerritorialStat.BUILD_SPEED), 0.0001);
    }

    @Test
    public void removeModifierClearsPlayerWhenEmpty() {
        stats.addModifier(player, new StatModifier("only", TerritorialStat.BUILD_SPEED, 1, StatOperation.ADD));
        assertTrue(stats.removeModifier(player, "only"));
        assertFalse(stats.hasModifier(player, "only"));
        assertTrue(stats.getModifiers(player).isEmpty());
        assertFalse(stats.removeModifier(player, "only")); // already gone
    }

    @Test
    public void clearPlayerRemovesEverything() {
        stats.addModifier(player, new StatModifier("a", TerritorialStat.SIEGE_DAMAGE, 1, StatOperation.ADD));
        stats.clearPlayer(player);
        assertTrue(stats.getModifiers(player).isEmpty());
        assertEquals(new StatTotals(0, 1).getMultiplyTotal(),
                stats.getStatTotals(player, TerritorialStat.SIEGE_DAMAGE).getMultiplyTotal(), 0.0001);
    }

    @Test
    public void nullArgumentsAreHandledGracefully() {
        // Must not throw, and must return neutral values.
        stats.addModifier(null, null);
        stats.addModifier(player, null);
        assertFalse(stats.hasModifier(null, "x"));
        assertFalse(stats.hasModifier(player, null));
        assertFalse(stats.removeModifier(null, "x"));
        assertFalse(stats.removeModifier(player, ""));
        assertTrue(stats.getModifiers(null).isEmpty());
        stats.clearPlayer(null);
        StatTotals neutral = stats.getStatTotals(null, null);
        assertEquals(0, neutral.getAddTotal(), 0.0001);
        assertEquals(1, neutral.getMultiplyTotal(), 0.0001);
    }

    @Test(expected = UnsupportedOperationException.class)
    public void getModifiersReturnsUnmodifiableView() {
        stats.addModifier(player, new StatModifier("a", TerritorialStat.ATTACK_DAMAGE, 1, StatOperation.ADD));
        stats.getModifiers(player).clear();
    }
}

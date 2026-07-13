package org.redcastlemedia.multitallented.civs.spells;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SpellArithmeticTests {

    @Test
    public void evaluatePlainNumber() {
        assertEquals(10000.0, Spell.evaluateArithmetic("10000"), 0.001);
    }

    @Test
    public void evaluateAdditionAndMultiplication() {
        assertEquals(13.0, Spell.evaluateArithmetic("5*2+3"), 0.001);
    }

    @Test
    public void evaluateParentheses() {
        assertEquals(20.0, Spell.evaluateArithmetic("(5+5)*2"), 0.001);
    }

    @Test
    public void getLevelAdjustedValueWithoutScriptEngine() {
        assertEquals(15.0, Spell.getLevelAdjustedValue("15", 1, null, null), 0.001);
        assertEquals(7.0, Spell.getLevelAdjustedValue("5+2", 1, null, null), 0.001);
    }
}

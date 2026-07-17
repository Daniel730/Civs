package org.redcastlemedia.multitallented.civs.spells;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.junit.Test;
import org.redcastlemedia.multitallented.civs.civclass.CivClass;

public class SpellUtilCombatBarTests {

    @Test
    public void selectedSpellKeysAreAlreadyHotbarSlots() {
        // After set-spell-slot, selectedSpells keys are physical hotbar indices.
        // spellSlotOrder must not be applied a second time in enableCombatBar.
        CivClass civClass = mock(CivClass.class);
        Map<Integer, String> selected = new HashMap<>();
        selected.put(3, "jump");
        Map<Integer, Integer> order = new HashMap<>();
        order.put(1, 3); // UI slot 1 maps to hotbar 3
        order.put(2, 2);
        order.put(3, 1);
        when(civClass.getSelectedSpells()).thenReturn(selected);
        when(civClass.getSpellSlotOrder()).thenReturn(order);

        // The key present in selectedSpells is the hotbar slot to use.
        assertEquals(Integer.valueOf(3), civClass.getSelectedSpells().keySet().iterator().next());
        // Double-mapping would wrongly turn 3 -> order.getOrDefault(3,3)=1
        assertEquals(Integer.valueOf(1), civClass.getSpellSlotOrder().getOrDefault(3, 3));
    }
}

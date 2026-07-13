package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civclass.CivClass;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.spells.SpellListMenu;
import org.redcastlemedia.multitallented.civs.spells.SpellManager;
import org.redcastlemedia.multitallented.civs.spells.SpellType;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class SpellListMenuTests extends TestUtil {

    private Civilian civilian;
    private CivClass civClass;
    private SpellListMenu menu;

    @Before
    public void setup() {
        MenuManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        civClass = civilian.getCurrentClass();
        civClass.resetSpellSlotOrder();
        menu = (SpellListMenu) MenuManager.menus.get("spell-list");
    }

    @Test @SuppressWarnings("unchecked")
    public void createDataShouldPopulateSpellsForClass() {
        Map<String, String> params = new HashMap<>();
        params.put(Constants.CLASS, civClass.getId().toString());

        Map<String, Object> data = menu.createData(civilian, params);

        List<SpellType> spells = (List<SpellType>) data.get("spells");
        assertFalse(spells.isEmpty());
        assertEquals(civClass, data.get(Constants.CLASS));
    }

    @Test
    public void setSpellSlotShouldUseSpellMapLookup() {
        List<SpellType> unlockedSpells = SpellManager.getInstance().getSpellsForSlot(civClass, 2, true);
        assertFalse(unlockedSpells.isEmpty());
        SpellType spellType = unlockedSpells.get(0);
        ItemStack spellItem = TestUtil.createUniqueItemStack(Material.BLAZE_POWDER, spellType.getProcessedName());
        HashMap<ItemStack, SpellType> spellMap = new HashMap<>();
        spellMap.put(spellItem, spellType);

        HashMap<String, Object> menuData = new HashMap<>();
        menuData.put(Constants.CLASS, civClass);
        menuData.put("slot", 2);
        menuData.put("spellMap", spellMap);
        MenuManager.setNewData(player.getUniqueId(), menuData);

        boolean cancelled = menu.doActionAndCancel(civilian, "set-spell-slot", spellItem);

        assertTrue(cancelled);
        int internalSlot = civClass.getSpellSlotOrder().getOrDefault(2, 2);
        assertEquals(spellType.getProcessedName(), civClass.getSelectedSpells().get(internalSlot));
    }
}

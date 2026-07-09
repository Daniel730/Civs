package org.redcastlemedia.multitallented.civs.menus.common;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Collections;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;

public class LanguageMenuTests extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.getInstance().reload();
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        civilian.setLocale("en");
    }

    @Test
    public void selectLangActionShouldPersistLocaleFromLegacyLore() {
        LanguageMenu menu = new LanguageMenu();
        ItemStack itemStack = TestUtil.createUniqueItemStack(Material.BOOK, "Português");
        itemStack.getItemMeta().setLore(Collections.singletonList("pt_br"));

        boolean cancelled = menu.doActionAndCancel(civilian, "select-lang", itemStack);

        assertTrue(cancelled);
        assertEquals("pt_br", civilian.getLocale());
    }
}

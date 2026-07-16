package org.redcastlemedia.multitallented.civs.spells;

import java.util.Map;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.civclass.CivClass;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.util.Util;

public final class SpellUtil {
    private SpellUtil() {

    }

    /**
     * {@link CivClass#getSelectedSpells()} keys are already physical hotbar slots
     * (1-based) after {@code set-spell-slot} stores via {@code spellSlotOrder}.
     * Do not map through {@code spellSlotOrder} again.
     */
    public static void enableCombatBar(Player player, Civilian civilian) {
        for (Map.Entry<Integer, String> entry : civilian.getCurrentClass().getSelectedSpells().entrySet()) {
            int hotbarSlot = entry.getKey();
            SpellType spellType = (SpellType) ItemManager.getInstance().getItemType(entry.getValue());
            if (spellType == null || hotbarSlot < 1 || hotbarSlot > 9) {
                continue;
            }
            ItemStack itemStack = player.getInventory().getItem(hotbarSlot - 1);
            if (itemStack == null) {
                itemStack = new ItemStack(Material.AIR);
            }
            civilian.getCombatBar().put(hotbarSlot, itemStack);
            CVItem cvItem = spellType.clone();
            String localSpellName = spellType.getDisplayName(player);
            cvItem.setDisplayName(localSpellName);
            cvItem.getLore().clear();
            cvItem.setOwnerBound(civilian.getUuid());
            cvItem.setCivItemName(spellType.getProcessedName());
            cvItem.getLore().addAll(Util.textWrap(civilian, LocaleManager.getInstance().getTranslation(player,
                    "switch-spell-cast")));

            player.getInventory().setItem(hotbarSlot - 1, cvItem.createItemStack());
        }
    }

    public static void removeCombatBar(Player player, Civilian civilian) {
        CivClass civClass = civilian.getCurrentClass();
        for (Integer hotbarSlot : civClass.getSelectedSpells().keySet()) {
            if (hotbarSlot == null || hotbarSlot < 1 || hotbarSlot > 9) {
                continue;
            }
            ItemStack itemStack = civilian.getCombatBar().getOrDefault(hotbarSlot, new ItemStack(Material.AIR));
            if (CVItem.isCivsItem(itemStack)) {
                CivItem civItem = CivItem.getFromItemStack(itemStack);
                if (civItem != null && civItem.getItemType() == CivItem.ItemType.SPELL) {
                    itemStack = new ItemStack(Material.AIR);
                }
            }
            ItemStack currentItem = player.getInventory().getItem(hotbarSlot - 1);
            if (CVItem.isCivsItem(currentItem)) {
                player.getInventory().setItem(hotbarSlot - 1, itemStack);
            }
        }
        civilian.getCombatBar().clear();
    }
}

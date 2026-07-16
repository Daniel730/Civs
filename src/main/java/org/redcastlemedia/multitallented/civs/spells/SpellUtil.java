package org.redcastlemedia.multitallented.civs.spells;

import java.util.Map;

import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
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
     * Temporarily replaces hotbar slots with equipped spells (combat mode ON).
     * Call {@link #removeCombatBar} to restore saved tools. Scroll wheel will not cast —
     * right-click casts via {@link SpellListener}.
     */
    public static void enableCombatBar(Player player, Civilian civilian) {
        if (!civilian.getCombatBar().isEmpty()) {
            return;
        }
        for (Map.Entry<Integer, String> entry : civilian.getCurrentClass().getSelectedSpells().entrySet()) {
            int hotbarSlot = entry.getKey();
            SpellType spellType = (SpellType) ItemManager.getInstance().getItemType(entry.getValue());
            if (spellType == null || hotbarSlot < 1 || hotbarSlot > 9) {
                continue;
            }
            ItemStack itemStack = player.getInventory().getItem(hotbarSlot - 1);
            if (itemStack == null) {
                itemStack = new ItemStack(Material.AIR);
            } else {
                itemStack = itemStack.clone();
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
            cvItem.getLore().addAll(Util.textWrap(civilian, LocaleManager.getInstance().getTranslation(player,
                    "combat-bar-exit-hint")));

            player.getInventory().setItem(hotbarSlot - 1, cvItem.createItemStack());
        }
        player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player,
                "combat-bar-enabled"));
    }

    /**
     * Restores every hotbar item saved when combat mode was enabled.
     */
    public static void removeCombatBar(Player player, Civilian civilian) {
        if (civilian.getCombatBar().isEmpty()) {
            return;
        }
        for (Map.Entry<Integer, ItemStack> entry : civilian.getCombatBar().entrySet()) {
            Integer hotbarSlot = entry.getKey();
            if (hotbarSlot == null || hotbarSlot < 1 || hotbarSlot > 9) {
                continue;
            }
            ItemStack restored = entry.getValue();
            if (restored == null) {
                restored = new ItemStack(Material.AIR);
            } else if (CVItem.isCivsItem(restored)) {
                CivItem civItem = CivItem.getFromItemStack(restored);
                if (civItem != null && civItem.getItemType() == CivItem.ItemType.SPELL) {
                    restored = new ItemStack(Material.AIR);
                }
            }
            player.getInventory().setItem(hotbarSlot - 1, restored.clone());
        }
        civilian.getCombatBar().clear();
        player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player,
                "combat-bar-disabled"));
    }

    public static boolean isCombatMode(Civilian civilian) {
        return civilian != null && !civilian.getCombatBar().isEmpty();
    }
}

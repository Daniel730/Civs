package org.redcastlemedia.multitallented.civs.menus.auction;

import java.util.HashMap;
import java.util.Map;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.menus.CivsMenu;
import org.redcastlemedia.multitallented.civs.menus.CustomMenu;
import org.redcastlemedia.multitallented.civs.menus.MenuIcon;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsMenu(name = "auction-sell")
@SuppressWarnings("unused")
public class AuctionSellMenu extends CustomMenu {

    @Override
    public Map<String, Object> createData(Civilian civilian, Map<String, String> params) {
        return new HashMap<>();
    }

    @Override
    protected ItemStack createItemStack(Civilian civilian, MenuIcon menuIcon, int count) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return new ItemStack(Material.AIR);
        }
        if ("hand-item".equals(menuIcon.getKey())) {
            ItemStack hand = player.getInventory().getItemInMainHand();
            if (hand.getType().isAir()) {
                ItemStack barrier = new ItemStack(Material.BARRIER);
                ItemMeta barrierMeta = barrier.getItemMeta();
                if (barrierMeta != null) {
                    barrierMeta.setDisplayName(LocaleManager.getInstance()
                            .getTranslation(player, "auction-no-item"));
                    barrier.setItemMeta(barrierMeta);
                }
                return barrier;
            }
            ItemStack display = hand.clone();
            putActions(civilian, menuIcon, display, count);
            return display;
        }
        if ("help".equals(menuIcon.getKey())) {
            ItemStack help = new ItemStack(Material.PAPER);
            ItemMeta meta = help.getItemMeta();
            if (meta != null) {
                LocaleManager localeManager = LocaleManager.getInstance();
                ConfigManager config = ConfigManager.getInstance();
                meta.setDisplayName(localeManager.getTranslation(player, "auction-sell-help-title"));
                meta.setLore(java.util.List.of(
                        localeManager.getTranslation(player, "auction-sell-help-command"),
                        localeManager.getTranslation(player, "auction-sell-help-tax")
                                .replace("$1", String.valueOf(config.getAuctionListingTaxPercent())),
                        localeManager.getTranslation(player, "auction-sell-help-duration")
                                .replace("$1", String.valueOf(config.getAuctionListingDurationHours())),
                        localeManager.getTranslation(player, "auction-sell-help-limits")
                                .replace("$1", Util.getNumberFormat(config.getAuctionMinPrice(), civilian.getLocale()))
                                .replace("$2", Util.getNumberFormat(config.getAuctionMaxPrice(), civilian.getLocale()))
                ));
                help.setItemMeta(meta);
            }
            putActions(civilian, menuIcon, help, count);
            return help;
        }
        return super.createItemStack(civilian, menuIcon, count);
    }

    @Override
    public boolean doActionAndCancel(Civilian civilian, String actionString, ItemStack clickedItem) {
        if ("open-browse".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player != null) {
                MenuManager.getInstance().openMenu(player, "auction-browse", new HashMap<>());
            }
            return true;
        }
        return super.doActionAndCancel(civilian, actionString, clickedItem);
    }
}

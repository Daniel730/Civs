package org.redcastlemedia.multitallented.civs.auction;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Visual/audio feedback for successful auction purchases.
 */
public final class AuctionFeedback {

    private AuctionFeedback() {
    }

    public static void onPurchaseSuccess(Player buyer, AuctionListing listing) {
        if (!ConfigManager.getInstance().isAuctionPurchaseFeedback() || buyer == null || listing == null) {
            return;
        }
        String title = LocaleManager.getInstance().getTranslation(buyer, "auction-purchase-title");
        buyer.sendTitle(ChatColor.GREEN + title, "", 5, 30, 10);
        buyer.playSound(buyer.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.8f, 1.2f);

        Player seller = Bukkit.getPlayer(listing.getSellerId());
        if (seller == null || !seller.isOnline()) {
            return;
        }
        String price = Util.getNumberFormat(listing.getPrice(),
                CivilianManager.getInstance().getCivilian(seller.getUniqueId()).getLocale());
        String itemName = displayItemName(listing.getItem());
        String message = Civs.getPrefix() + LocaleManager.getInstance()
                .getTranslation(seller, "auction-item-sold")
                .replace("$1", itemName)
                .replace("$2", price);
        seller.sendMessage(message);
    }

    private static String displayItemName(ItemStack item) {
        if (item.hasItemMeta() && item.getItemMeta().hasDisplayName()) {
            String custom = item.getItemMeta().getDisplayName();
            if (custom != null && !custom.isEmpty()) {
                return custom;
            }
        }
        return item.getType().name();
    }
}

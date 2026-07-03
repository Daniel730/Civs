package org.redcastlemedia.multitallented.civs.menus.auction;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.auction.AuctionListing;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.auction.AuctionResult;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.menus.CivsMenu;
import org.redcastlemedia.multitallented.civs.menus.CustomMenu;
import org.redcastlemedia.multitallented.civs.menus.MenuIcon;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsMenu(name = "auction-my-listings")
@SuppressWarnings("unused")
public class AuctionMyListingsMenu extends CustomMenu {

    @Override
    public Map<String, Object> createData(Civilian civilian, Map<String, String> params) {
        Map<String, Object> data = new HashMap<>();
        int page = params.containsKey("page") ? Integer.parseInt(params.get("page")) : 0;
        data.put("page", page);
        List<AuctionListing> listings = AuctionManager.getInstance().getListingsForSeller(civilian.getUuid());
        data.put("listings", listings);
        int perPage = itemsPerPage.getOrDefault("items", 45);
        int maxPage = (int) Math.ceil((double) listings.size() / perPage);
        data.put("maxPage", Math.max(0, maxPage - 1));
        return data;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected ItemStack createItemStack(Civilian civilian, MenuIcon menuIcon, int count) {
        if (!"items".equals(menuIcon.getKey())) {
            return super.createItemStack(civilian, menuIcon, count);
        }
        List<AuctionListing> listings = (List<AuctionListing>) MenuManager.getData(civilian.getUuid(), "listings");
        if (listings == null) {
            return new ItemStack(Material.AIR);
        }
        int page = (int) MenuManager.getData(civilian.getUuid(), "page");
        int index = count + menuIcon.getIndex().size() * page;
        if (listings.size() <= index) {
            return new ItemStack(Material.AIR);
        }
        AuctionListing listing = listings.get(index);
        ItemStack display = listing.getItem().clone();
        ItemMeta meta = display.getItemMeta();
        if (meta != null) {
            List<String> lore = meta.hasLore() ? new ArrayList<>(meta.getLore()) : new ArrayList<>();
            Player player = Bukkit.getPlayer(civilian.getUuid());
            LocaleManager localeManager = LocaleManager.getInstance();
            lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-price")
                    .replace("$1", Util.getNumberFormat(listing.getPrice(), civilian.getLocale())));
            lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-expires")
                    .replace("$1", formatDuration(listing.getExpiresAt() - System.currentTimeMillis())));
            lore.add(ChatColor.DARK_GRAY + localeManager.getTranslation(player, "auction-click-cancel"));
            lore.add(ChatColor.DARK_GRAY + listing.getId());
            meta.setLore(lore);
            display.setItemMeta(meta);
        }
        putActions(civilian, menuIcon, display, count);
        return display;
    }

    @Override
    public boolean doActionAndCancel(Civilian civilian, String actionString, ItemStack clickedItem) {
        if ("cancel-listing".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player == null || clickedItem == null || !clickedItem.hasItemMeta() || !clickedItem.getItemMeta().hasLore()) {
                return true;
            }
            List<String> lore = clickedItem.getItemMeta().getLore();
            if (lore == null || lore.isEmpty()) {
                return true;
            }
            String listingId = ChatColor.stripColor(lore.get(lore.size() - 1));
            AuctionResult result = AuctionManager.getInstance().cancelListing(player, listingId);
            LocaleManager localeManager = LocaleManager.getInstance();
            if (result == AuctionResult.SUCCESS) {
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cancelled"));
                MenuManager.getInstance().refreshMenu(civilian);
            } else {
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-not-found"));
            }
            return true;
        } else if ("open-browse".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player != null) {
                MenuManager.getInstance().openMenu(player, "auction-browse", new HashMap<>());
            }
            return true;
        }
        return super.doActionAndCancel(civilian, actionString, clickedItem);
    }

    private String formatDuration(long millis) {
        if (millis <= 0) {
            return "0m";
        }
        long hours = TimeUnit.MILLISECONDS.toHours(millis);
        long minutes = TimeUnit.MILLISECONDS.toMinutes(millis) % 60;
        if (hours > 0) {
            return hours + "h " + minutes + "m";
        }
        return minutes + "m";
    }
}

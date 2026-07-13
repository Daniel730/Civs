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
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.auction.AuctionListing;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.auction.AuctionResult;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.items.CVItem;
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
        int page = parsePageParam(params.get("page"));
        List<AuctionListing> listings = AuctionManager.getInstance().getListingsForSeller(civilian.getUuid());
        data.put("listings", listings);
        int perPage = itemsPerPage.getOrDefault("items", 45);
        int maxPage = (int) Math.ceil((double) listings.size() / perPage);
        int safeMaxPage = Math.max(0, maxPage - 1);
        data.put("maxPage", safeMaxPage);
        data.put("page", Math.min(Math.max(0, page), safeMaxPage));
        return data;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected ItemStack createItemStack(Civilian civilian, MenuIcon menuIcon, int count) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if ("title".equals(menuIcon.getKey()) && player != null) {
            CVItem cvItem = menuIcon.createCVItem(player, count);
            List<AuctionListing> listings = (List<AuctionListing>) MenuManager.getData(civilian.getUuid(), "listings");
            if (listings == null || listings.isEmpty()) {
                cvItem.setLore(List.of(LocaleManager.getInstance().getTranslation(player, "auction-my-empty")));
            }
            ItemStack itemStack = cvItem.createItemStack();
            putActions(civilian, menuIcon, itemStack, count);
            return itemStack;
        }
        if (!"items".equals(menuIcon.getKey())) {
            return super.createItemStack(civilian, menuIcon, count);
        }
        if (player == null) {
            return new ItemStack(Material.AIR);
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
        ItemStack listingItem = listing.getItem();
        if (listingItem == null || listingItem.getType() == Material.AIR) {
            return new ItemStack(Material.AIR);
        }
        ItemStack display = listingItem.clone();
        List<String> existingLore = CVItem.legacyLore(display);
        List<String> lore = existingLore != null ? new ArrayList<>(existingLore) : new ArrayList<>();
        LocaleManager localeManager = LocaleManager.getInstance();
        lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-price")
                .replace("$1", Util.getNumberFormat(listing.getPrice(), civilian.getLocale())));
        lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-expires")
                .replace("$1", formatDuration(listing.getExpiresAt() - System.currentTimeMillis())));
        lore.add(ChatColor.DARK_GRAY + localeManager.getTranslation(player, "auction-click-cancel"));
        lore.add(ChatColor.DARK_GRAY + listing.getId());
        CVItem.applyLore(display, lore);
        putActions(civilian, menuIcon, display, count);
        return display;
    }

    @Override
    public boolean doActionAndCancel(Civilian civilian, String actionString, ItemStack clickedItem) {
        if ("cancel-listing".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player == null || clickedItem == null || !clickedItem.hasItemMeta()) {
                return true;
            }
            List<String> lore = CVItem.legacyLore(clickedItem);
            if (lore == null || lore.isEmpty()) {
                return true;
            }
            String listingId = ChatColor.stripColor(lore.get(lore.size() - 1));
            AuctionResult result = AuctionManager.getInstance().cancelListing(player, listingId);
            sendCancelResult(player, civilian, result);
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

    private void sendCancelResult(Player player, Civilian civilian, AuctionResult result) {
        LocaleManager localeManager = LocaleManager.getInstance();
        switch (result) {
            case SUCCESS -> {
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cancelled"));
                MenuManager.getInstance().refreshMenu(civilian);
            }
            case NOT_FOUND, EXPIRED -> {
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-not-found"));
                MenuManager.getInstance().refreshMenu(civilian);
            }
            case NOT_OWNER -> player.sendMessage(Civs.getPrefix()
                    + localeManager.getTranslation(player, "no-permission"));
            default -> player.sendMessage(Civs.getPrefix()
                    + localeManager.getTranslation(player, "auction-failed"));
        }
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

    private static int parsePageParam(String pageValue) {
        if (pageValue == null || pageValue.isEmpty()) {
            return 0;
        }
        try {
            return Integer.parseInt(pageValue);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }
}

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
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.menus.CivsMenu;
import org.redcastlemedia.multitallented.civs.menus.CustomMenu;
import org.redcastlemedia.multitallented.civs.menus.MenuIcon;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsMenu(name = "auction-browse")
@SuppressWarnings("unused")
public class AuctionBrowseMenu extends CustomMenu {

    @Override
    public Map<String, Object> createData(Civilian civilian, Map<String, String> params) {
        Map<String, Object> data = new HashMap<>();
        int page = params.containsKey("page") ? Integer.parseInt(params.get("page")) : 0;
        String sort = params.getOrDefault("sort", "price_asc");
        String filter = params.getOrDefault("filter", "");
        data.put("page", page);
        data.put("sort", sort);
        data.put("filter", filter);
        List<AuctionListing> listings = AuctionManager.getInstance().getBrowseListings(sort, filter);
        data.put("listings", listings);
        int perPage = itemsPerPage.getOrDefault("items", 45);
        int maxPage = (int) Math.ceil((double) listings.size() / perPage);
        data.put("maxPage", Math.max(0, maxPage - 1));
        return data;
    }

    @Override
    @SuppressWarnings("unchecked")
    protected ItemStack createItemStack(Civilian civilian, MenuIcon menuIcon, int count) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return new ItemStack(Material.AIR);
        }
        LocaleManager localeManager = LocaleManager.getInstance();
        String sort = (String) MenuManager.getData(civilian.getUuid(), "sort");
        String filter = (String) MenuManager.getData(civilian.getUuid(), "filter");
        if ("sort-price".equals(menuIcon.getKey())) {
            CVItem cvItem = menuIcon.createCVItem(player, count);
            String loreKey = "price_desc".equals(sort) ? "auction-sort-price-desc" : "auction-sort-price-asc";
            cvItem.setLore(List.of(localeManager.getTranslation(player, loreKey)));
            ItemStack itemStack = cvItem.createItemStack();
            putActions(civilian, menuIcon, itemStack, count);
            return itemStack;
        }
        if ("sort-name".equals(menuIcon.getKey())) {
            CVItem cvItem = menuIcon.createCVItem(player, count);
            String loreKey = "name_desc".equals(sort) ? "auction-sort-name-desc" : "auction-sort-name-asc";
            cvItem.setLore(List.of(localeManager.getTranslation(player, loreKey)));
            ItemStack itemStack = cvItem.createItemStack();
            putActions(civilian, menuIcon, itemStack, count);
            return itemStack;
        }
        if ("filter-material".equals(menuIcon.getKey())) {
            if (filter != null && !filter.isEmpty()) {
                return new ItemStack(Material.AIR);
            }
            CVItem cvItem = menuIcon.createCVItem(player, count);
            if (filter != null && !filter.isEmpty()) {
                cvItem.setLore(List.of(localeManager.getTranslation(player, "auction-filter-active")
                        .replace("$1", filter)));
            } else {
                cvItem.setLore(List.of(localeManager.getTranslation(player, "auction-filter-hint")));
            }
            ItemStack itemStack = cvItem.createItemStack();
            putActions(civilian, menuIcon, itemStack, count);
            return itemStack;
        }
        if ("clear-filter".equals(menuIcon.getKey())) {
            if (filter == null || filter.isEmpty()) {
                return new ItemStack(Material.AIR);
            }
            return super.createItemStack(civilian, menuIcon, count);
        }
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
            lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-price")
                    .replace("$1", Util.getNumberFormat(listing.getPrice(), civilian.getLocale())));
            lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-seller")
                    .replace("$1", listing.getSellerName()));
            lore.add(ChatColor.GRAY + localeManager.getTranslation(player, "auction-expires")
                    .replace("$1", formatDuration(listing.getExpiresAt() - System.currentTimeMillis())));
            lore.add(ChatColor.DARK_GRAY + listing.getId());
            meta.setLore(lore);
            display.setItemMeta(meta);
        }
        putActions(civilian, menuIcon, display, count);
        return display;
    }

    @Override
    public boolean doActionAndCancel(Civilian civilian, String actionString, ItemStack clickedItem) {
        if ("buy-listing".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player == null) {
                return true;
            }
            String listingId = getListingId(clickedItem);
            if (listingId == null) {
                return true;
            }
            AuctionResult result = AuctionManager.getInstance().purchaseListing(player, listingId);
            sendPurchaseResult(player, civilian, result);
            if (result == AuctionResult.SUCCESS) {
                MenuManager.getInstance().refreshMenu(civilian);
            }
            return true;
        } else if ("open-my-listings".equals(actionString)) {
            Player player = Bukkit.getPlayer(civilian.getUuid());
            if (player != null) {
                MenuManager.getInstance().openMenu(player, "auction-my-listings", new HashMap<>());
            }
            return true;
        } else if ("sort-price".equals(actionString)) {
            String current = (String) MenuManager.getData(civilian.getUuid(), "sort");
            if ("price_desc".equals(current)) {
                reopenWithSort(civilian, "price_asc");
            } else {
                reopenWithSort(civilian, "price_desc");
            }
            return true;
        } else if ("sort-name".equals(actionString)) {
            String current = (String) MenuManager.getData(civilian.getUuid(), "sort");
            if ("name_desc".equals(current)) {
                reopenWithSort(civilian, "name_asc");
            } else {
                reopenWithSort(civilian, "name_desc");
            }
            return true;
        } else if ("filter-material".equals(actionString)) {
            return applyMaterialFilter(civilian);
        } else if ("clear-filter".equals(actionString)) {
            reopenWithFilter(civilian, "");
            return true;
        }
        return super.doActionAndCancel(civilian, actionString, clickedItem);
    }

    private boolean applyMaterialFilter(Civilian civilian) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return true;
        }
        ItemStack hand = player.getInventory().getItemInMainHand();
        if (hand.getType().isAir()) {
            player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                    .getTranslation(player, "auction-filter-no-item"));
            return true;
        }
        String material = hand.getType().name();
        String currentFilter = (String) MenuManager.getData(civilian.getUuid(), "filter");
        if (material.equalsIgnoreCase(currentFilter)) {
            reopenWithFilter(civilian, "");
        } else {
            reopenWithFilter(civilian, material);
        }
        return true;
    }

    private void reopenWithSort(Civilian civilian, String sort) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return;
        }
        HashMap<String, String> params = new HashMap<>();
        params.put("sort", sort);
        String filter = (String) MenuManager.getData(civilian.getUuid(), "filter");
        if (filter != null && !filter.isEmpty()) {
            params.put("filter", filter);
        }
        MenuManager.getInstance().openMenu(player, "auction-browse", params);
    }

    private void reopenWithFilter(Civilian civilian, String filter) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return;
        }
        HashMap<String, String> params = new HashMap<>();
        String sort = (String) MenuManager.getData(civilian.getUuid(), "sort");
        if (sort != null && !sort.isEmpty()) {
            params.put("sort", sort);
        }
        if (filter != null && !filter.isEmpty()) {
            params.put("filter", filter);
        }
        MenuManager.getInstance().openMenu(player, "auction-browse", params);
    }

    private String getListingId(ItemStack clickedItem) {
        if (clickedItem == null || !clickedItem.hasItemMeta() || !clickedItem.getItemMeta().hasLore()) {
            return null;
        }
        List<String> lore = clickedItem.getItemMeta().getLore();
        if (lore == null || lore.isEmpty()) {
            return null;
        }
        return ChatColor.stripColor(lore.get(lore.size() - 1));
    }

    private void sendPurchaseResult(Player player, Civilian civilian, AuctionResult result) {
        LocaleManager localeManager = LocaleManager.getInstance();
        switch (result) {
            case SUCCESS:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-purchased"));
                break;
            case INSUFFICIENT_FUNDS:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "not-enough-money")
                        .replace("$1", "?"));
                break;
            case CANNOT_BUY_OWN:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cannot-buy-own"));
                break;
            case EXPIRED:
            case NOT_FOUND:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-expired"));
                MenuManager.getInstance().refreshMenu(civilian);
                break;
            case INVENTORY_FULL:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-inventory-full"));
                break;
            case EVENT_CANCELLED:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cancelled-event"));
                break;
            default:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-failed"));
                break;
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
}

package org.redcastlemedia.multitallented.civs.auction;

import java.io.File;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.events.AuctionListEvent;
import org.redcastlemedia.multitallented.civs.events.AuctionPurchaseEvent;
import org.redcastlemedia.multitallented.civs.events.TwoSecondEvent;

@CivsSingleton(priority = CivsSingleton.SingletonLoadPriority.HIGH)
public class AuctionManager implements Listener {
    private static AuctionManager instance;

    private final Map<String, AuctionListing> listings = new HashMap<>();
    private final Map<UUID, List<ItemStack>> pendingReturns = new HashMap<>();

    public static AuctionManager getInstance() {
        if (instance == null) {
            instance = new AuctionManager();
            if (Civs.getInstance() != null) {
                instance.loadAll();
                Bukkit.getPluginManager().registerEvents(instance, Civs.getInstance());
            }
        }
        return instance;
    }

    public void reload() {
        listings.clear();
        pendingReturns.clear();
        if (Civs.getInstance() != null) {
            loadAll();
        }
    }

    public void saveAll() {
        saveListings();
        savePendingReturns();
    }

    public boolean isEnabled() {
        return ConfigManager.getInstance().isUseAuctionHouse() && Civs.econ != null;
    }

    public List<AuctionListing> getActiveListings() {
        return getBrowseListings("price_asc", null);
    }

    public List<AuctionListing> getBrowseListings(String sort, String materialFilter) {
        purgeExpiredListings();
        List<AuctionListing> active = new ArrayList<>();
        for (AuctionListing listing : listings.values()) {
            ItemStack item = listing.getItem();
            if (item == null || item.getType() == Material.AIR) {
                continue;
            }
            if (materialFilter != null && !materialFilter.isEmpty()
                    && !item.getType().name().equalsIgnoreCase(materialFilter)) {
                continue;
            }
            active.add(listing);
        }
        active.sort(browseComparator(sort));
        return active;
    }

    private Comparator<AuctionListing> browseComparator(String sort) {
        if (sort == null || sort.isEmpty()) {
            sort = "price_asc";
        }
        return switch (sort) {
            case "price_desc" -> Comparator.comparingDouble(AuctionListing::getPrice).reversed()
                    .thenComparing(AuctionListing::getListedAt);
            case "name_asc" -> Comparator.comparing(
                    (AuctionListing listing) -> displayName(listing.getItem()), String.CASE_INSENSITIVE_ORDER)
                    .thenComparingDouble(AuctionListing::getPrice);
            case "name_desc" -> Comparator.comparing(
                    (AuctionListing listing) -> displayName(listing.getItem()), String.CASE_INSENSITIVE_ORDER).reversed()
                    .thenComparingDouble(AuctionListing::getPrice);
            default -> Comparator.comparingDouble(AuctionListing::getPrice)
                    .thenComparingLong(AuctionListing::getListedAt);
        };
    }

    private String displayName(ItemStack item) {
        if (item == null || item.getType() == Material.AIR) {
            return "";
        }
        String custom = CVItem.legacyDisplayName(item);
        if (custom != null && !custom.isEmpty()) {
            return custom;
        }
        return item.getType().name();
    }

    public int getActiveListingCount() {
        purgeExpiredListings();
        return listings.size();
    }

    public int getListingCountForSeller(UUID sellerId) {
        return getListingsForSeller(sellerId).size();
    }

    public List<AuctionListing> getListingsForSeller(UUID sellerId) {
        purgeExpiredListings();
        List<AuctionListing> owned = new ArrayList<>();
        for (AuctionListing listing : listings.values()) {
            if (sellerId.equals(listing.getSellerId())) {
                owned.add(listing);
            }
        }
        owned.sort(Comparator.comparingLong(AuctionListing::getListedAt));
        return owned;
    }

    public AuctionListing getListing(String id) {
        return listings.get(id);
    }

    public int getPendingReturnCount(UUID playerId) {
        List<ItemStack> items = pendingReturns.get(playerId);
        return items == null ? 0 : items.size();
    }

    public AuctionResult listItem(Player seller, ItemStack sourceItem, double price) {
        if (!isEnabled()) {
            return AuctionResult.DISABLED;
        }
        ItemStack hand = sourceItem != null && !sourceItem.getType().isAir()
                ? sourceItem
                : seller.getInventory().getItemInMainHand();
        if (hand == null || hand.getType().isAir()) {
            return AuctionResult.INVALID_ITEM;
        }
        ConfigManager config = ConfigManager.getInstance();
        if (price < config.getAuctionMinPrice() || price > config.getAuctionMaxPrice()) {
            return AuctionResult.INVALID_PRICE;
        }
        if (getListingsForSeller(seller.getUniqueId()).size() >= config.getAuctionMaxListingsPerPlayer()) {
            return AuctionResult.MAX_LISTINGS;
        }

        double tax = calculateListingTax(price);
        if (tax > 0 && !Civs.econ.has(seller, tax)) {
            return AuctionResult.INSUFFICIENT_FUNDS;
        }

        ItemStack listingItem = hand.clone();
        String listingId = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        long expiresAt = now + (config.getAuctionListingDurationHours() * 3600_000L);

        AuctionListEvent listEvent = new AuctionListEvent(seller.getUniqueId(), listingId, listingItem, price, tax);
        Bukkit.getPluginManager().callEvent(listEvent);
        if (listEvent.isCancelled()) {
            return AuctionResult.EVENT_CANCELLED;
        }

        if (tax > 0) {
            Civs.econ.withdrawPlayer(seller, tax);
        }

        seller.getInventory().setItemInMainHand(new org.bukkit.inventory.ItemStack(org.bukkit.Material.AIR));

        AuctionListing listing = new AuctionListing();
        listing.setId(listingId);
        listing.setSellerId(seller.getUniqueId());
        listing.setSellerName(seller.getName());
        listing.setItem(listingItem);
        listing.setPrice(price);
        listing.setListedAt(now);
        listing.setExpiresAt(expiresAt);
        listings.put(listingId, listing);
        saveListing(listing);
        return AuctionResult.SUCCESS;
    }

    public AuctionResult purchaseListing(Player buyer, String listingId) {
        if (!isEnabled()) {
            return AuctionResult.DISABLED;
        }
        if (listingId == null || listingId.isEmpty()) {
            return AuctionResult.NOT_FOUND;
        }
        AuctionListing listing = listings.get(listingId);
        if (listing == null) {
            return AuctionResult.NOT_FOUND;
        }
        if (listing.isExpired()) {
            expireListing(listing);
            return AuctionResult.EXPIRED;
        }
        if (buyer.getUniqueId().equals(listing.getSellerId())) {
            return AuctionResult.CANNOT_BUY_OWN;
        }
        if (!Civs.econ.has(buyer, listing.getPrice())) {
            return AuctionResult.INSUFFICIENT_FUNDS;
        }

        ItemStack purchasedItem = listing.getItem();
        if (purchasedItem == null || purchasedItem.getType() == Material.AIR || purchasedItem.getAmount() < 1) {
            listings.remove(listing.getId());
            removeListingFile(listing);
            return AuctionResult.NOT_FOUND;
        }
        purchasedItem = purchasedItem.clone();
        AuctionPurchaseEvent purchaseEvent = new AuctionPurchaseEvent(
                buyer.getUniqueId(),
                listing.getSellerId(),
                listing.getId(),
                purchasedItem,
                listing.getPrice());
        Bukkit.getPluginManager().callEvent(purchaseEvent);
        if (purchaseEvent.isCancelled()) {
            return AuctionResult.EVENT_CANCELLED;
        }

        Civs.econ.withdrawPlayer(buyer, listing.getPrice());
        Player seller = Bukkit.getPlayer(listing.getSellerId());
        if (seller != null) {
            Civs.econ.depositPlayer(seller, listing.getPrice());
        } else {
            Civs.econ.depositPlayer(Bukkit.getOfflinePlayer(listing.getSellerId()), listing.getPrice());
        }

        HashMap<Integer, ItemStack> leftover = buyer.getInventory().addItem(purchasedItem);
        if (!leftover.isEmpty()) {
            Civs.econ.depositPlayer(buyer, listing.getPrice());
            return AuctionResult.INVENTORY_FULL;
        }

        AuctionFeedback.onPurchaseSuccess(buyer, listing);
        removeListingFile(listing);
        listings.remove(listing.getId());
        return AuctionResult.SUCCESS;
    }

    public AuctionResult cancelListing(Player seller, String listingId) {
        if (!isEnabled()) {
            return AuctionResult.DISABLED;
        }
        if (listingId == null || listingId.isEmpty()) {
            return AuctionResult.NOT_FOUND;
        }
        AuctionListing listing = listings.get(listingId);
        if (listing == null) {
            return AuctionResult.NOT_FOUND;
        }
        if (!seller.getUniqueId().equals(listing.getSellerId())) {
            return AuctionResult.NOT_OWNER;
        }
        ItemStack item = listing.getItem();
        if (item != null && item.getType() != Material.AIR) {
            returnItemToPlayer(seller, item.clone());
        }
        removeListingFile(listing);
        listings.remove(listing.getId());
        return AuctionResult.SUCCESS;
    }

    public AuctionResult claimReturns(Player player) {
        List<ItemStack> items = pendingReturns.remove(player.getUniqueId());
        if (items == null || items.isEmpty()) {
            return AuctionResult.NOT_FOUND;
        }
        List<ItemStack> stillPending = new ArrayList<>();
        for (ItemStack item : items) {
            HashMap<Integer, ItemStack> leftover = player.getInventory().addItem(item);
            if (!leftover.isEmpty()) {
                stillPending.addAll(leftover.values());
            }
        }
        if (!stillPending.isEmpty()) {
            pendingReturns.put(player.getUniqueId(), stillPending);
            savePendingReturns();
            return AuctionResult.INVENTORY_FULL;
        }
        savePendingReturns();
        return AuctionResult.SUCCESS;
    }

    public double calculateListingTax(double price) {
        return price * ConfigManager.getInstance().getAuctionListingTaxPercent() / 100.0;
    }

    @EventHandler
    public void onTwoSecondEvent(TwoSecondEvent event) {
        if (!ConfigManager.getInstance().isUseAuctionHouse()) {
            return;
        }
        purgeExpiredListings();
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        if (!isEnabled() || getPendingReturnCount(event.getPlayer().getUniqueId()) < 1) {
            return;
        }
        Bukkit.getScheduler().runTaskLater(Civs.getInstance(), () -> {
            if (event.getPlayer().isOnline()) {
                event.getPlayer().sendMessage(Civs.getPrefix()
                        + "You have auction items to claim. Use /civs auction claim");
            }
        }, 40L);
    }

    private void purgeExpiredListings() {
        List<AuctionListing> expired = new ArrayList<>();
        for (AuctionListing listing : listings.values()) {
            if (listing.isExpired()) {
                expired.add(listing);
            }
        }
        for (AuctionListing listing : expired) {
            expireListing(listing);
        }
    }

    private void expireListing(AuctionListing listing) {
        ItemStack item = listing.getItem();
        if (item != null && item.getType() != Material.AIR) {
            queueReturn(listing.getSellerId(), item.clone());
        }
        removeListingFile(listing);
        listings.remove(listing.getId());

        Player seller = Bukkit.getPlayer(listing.getSellerId());
        if (seller != null) {
            seller.sendMessage(Civs.getPrefix() + "An auction listing expired. Use /civs auction claim");
        }
    }

    private void queueReturn(UUID playerId, ItemStack item) {
        pendingReturns.computeIfAbsent(playerId, ignored -> new ArrayList<>()).add(item);
        savePendingReturns();
    }

    private void returnItemToPlayer(Player player, ItemStack item) {
        HashMap<Integer, ItemStack> leftover = player.getInventory().addItem(item);
        for (ItemStack remaining : leftover.values()) {
            queueReturn(player.getUniqueId(), remaining);
        }
    }

    private File getAuctionFolder() {
        File folder = new File(Civs.dataLocation, "auctions");
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return folder;
    }

    private File getListingsFolder() {
        File folder = new File(getAuctionFolder(), "listings");
        if (!folder.exists()) {
            folder.mkdirs();
        }
        return folder;
    }

    private File getReturnsFile() {
        return new File(getAuctionFolder(), "returns.yml");
    }

    private void loadAll() {
        loadListings();
        loadPendingReturns();
    }

    private void loadListings() {
        listings.clear();
        File listingsFolder = getListingsFolder();
        File[] files = listingsFolder.listFiles();
        if (files == null) {
            return;
        }
        for (File listingFile : files) {
            if (!listingFile.getName().endsWith(".yml")) {
                continue;
            }
            try {
                FileConfiguration config = new YamlConfiguration();
                config.load(listingFile);
                AuctionListing listing = loadListingFromConfig(listingFile.getName().replace(".yml", ""), config);
                if (listing != null) {
                    if (listing.isExpired()) {
                        queueReturn(listing.getSellerId(), listing.getItem());
                        listingFile.delete();
                    } else {
                        listings.put(listing.getId(), listing);
                    }
                }
            } catch (Exception e) {
                Civs.logger.log(Level.WARNING, "Unable to load auction listing " + listingFile.getName(), e);
            }
        }
        savePendingReturns();
    }

    private AuctionListing loadListingFromConfig(String id, FileConfiguration config) {
        String sellerIdString = config.getString("seller-id");
        if (sellerIdString == null) {
            return null;
        }
        ConfigurationSection itemSection = config.getConfigurationSection("item");
        if (itemSection == null) {
            return null;
        }
        ItemStack item = ItemStack.deserialize(itemSection.getValues(true));
        if (item == null || item.getType().isAir()) {
            return null;
        }

        AuctionListing listing = new AuctionListing();
        listing.setId(id);
        listing.setSellerId(UUID.fromString(sellerIdString));
        listing.setSellerName(config.getString("seller-name", "Unknown"));
        listing.setItem(item);
        listing.setPrice(config.getDouble("price"));
        listing.setListedAt(config.getLong("listed-at"));
        listing.setExpiresAt(config.getLong("expires-at"));
        return listing;
    }

    private void saveListings() {
        for (AuctionListing listing : listings.values()) {
            saveListing(listing);
        }
    }

    private void saveListing(AuctionListing listing) {
        if (Civs.getInstance() == null) {
            return;
        }
        try {
            File listingFile = new File(getListingsFolder(), listing.getId() + ".yml");
            if (!listingFile.exists()) {
                listingFile.createNewFile();
            }
            FileConfiguration config = new YamlConfiguration();
            config.set("seller-id", listing.getSellerId().toString());
            config.set("seller-name", listing.getSellerName());
            config.set("price", listing.getPrice());
            config.set("listed-at", listing.getListedAt());
            config.set("expires-at", listing.getExpiresAt());
            config.set("item", listing.getItem().serialize());
            config.save(listingFile);
        } catch (Exception e) {
            Civs.logger.log(Level.SEVERE, "Unable to save auction listing " + listing.getId(), e);
        }
    }

    private void removeListingFile(AuctionListing listing) {
        File listingFile = new File(getListingsFolder(), listing.getId() + ".yml");
        if (listingFile.exists()) {
            listingFile.delete();
        }
    }

    private void loadPendingReturns() {
        pendingReturns.clear();
        File returnsFile = getReturnsFile();
        if (!returnsFile.exists()) {
            return;
        }
        try {
            FileConfiguration config = new YamlConfiguration();
            config.load(returnsFile);
            ConfigurationSection section = config.getConfigurationSection("returns");
            if (section == null) {
                return;
            }
            for (String key : section.getKeys(false)) {
                UUID playerId = UUID.fromString(key);
                List<ItemStack> items = new ArrayList<>();
                List<Map<?, ?>> serializedItems = section.getMapList(key);
                for (Map<?, ?> serialized : serializedItems) {
                    @SuppressWarnings("unchecked")
                    ItemStack item = ItemStack.deserialize((Map<String, Object>) serialized);
                    if (item != null && !item.getType().isAir()) {
                        items.add(item);
                    }
                }
                if (!items.isEmpty()) {
                    pendingReturns.put(playerId, items);
                }
            }
        } catch (Exception e) {
            Civs.logger.log(Level.WARNING, "Unable to load auction returns", e);
        }
    }

    private void savePendingReturns() {
        if (Civs.getInstance() == null) {
            return;
        }
        try {
            File returnsFile = getReturnsFile();
            if (!returnsFile.exists()) {
                returnsFile.createNewFile();
            }
            FileConfiguration config = new YamlConfiguration();
            for (Map.Entry<UUID, List<ItemStack>> entry : pendingReturns.entrySet()) {
                List<Map<String, Object>> serializedItems = new ArrayList<>();
                for (ItemStack item : entry.getValue()) {
                    serializedItems.add(item.serialize());
                }
                config.set("returns." + entry.getKey(), serializedItems);
            }
            config.save(returnsFile);
        } catch (Exception e) {
            Civs.logger.log(Level.SEVERE, "Unable to save auction returns", e);
        }
    }
}

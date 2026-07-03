package org.redcastlemedia.multitallented.civs.regions;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.util.ActionBarUtil;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Batches NPC hovel {@code bank-payout} deposits per upkeep tick and notifies the town owner once.
 */
public final class HovelBankNotifier {

    private static final Map<String, Double> PENDING_BY_TOWN = new HashMap<>();

    private HovelBankNotifier() {
    }

    public static void accumulateTownIncome(Town town, double amount) {
        if (town == null || amount <= 0 || !ConfigManager.getInstance().isHovelBankActionBar()) {
            return;
        }
        String townKey = town.getName().toLowerCase();
        PENDING_BY_TOWN.merge(townKey, amount, Double::sum);
    }

    public static void flushPending() {
        if (PENDING_BY_TOWN.isEmpty()) {
            return;
        }
        Map<String, Double> batch = new HashMap<>(PENDING_BY_TOWN);
        PENDING_BY_TOWN.clear();
        for (Map.Entry<String, Double> entry : batch.entrySet()) {
            Town town = org.redcastlemedia.multitallented.civs.towns.TownManager.getInstance()
                    .getTown(entry.getKey());
            if (town == null || entry.getValue() <= 0) {
                continue;
            }
            notifyTownOwner(town, entry.getValue());
        }
    }

    private static void notifyTownOwner(Town town, double amount) {
        UUID ownerId = findTownOwner(town);
        if (ownerId == null) {
            return;
        }
        Player owner = Bukkit.getPlayer(ownerId);
        if (owner == null || !owner.isOnline()) {
            return;
        }
        String formatted = Util.getNumberFormat(amount,
                CivilianManager.getInstance().getCivilian(ownerId).getLocale());
        String message = LocaleManager.getInstance()
                .getTranslation(owner, "hovel-bank-income")
                .replace("$1", formatted);
        ActionBarUtil.sendActionBar(owner, message);
    }

    private static UUID findTownOwner(Town town) {
        for (Map.Entry<UUID, String> entry : town.getRawPeople().entrySet()) {
            if (entry.getValue() != null && entry.getValue().contains(Constants.OWNER)) {
                return entry.getKey();
            }
        }
        return null;
    }
}

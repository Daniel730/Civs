package org.redcastlemedia.multitallented.civs.regions;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;

/**
 * Throttled chat tips when a region's upkeep is stuck (missing tools/inputs or full output).
 */
public final class RegionUpkeepNotifier {

    private static final Map<String, Long> LAST_NOTIFY_MS = new ConcurrentHashMap<>();

    private RegionUpkeepNotifier() {
    }

    public static void maybeNotifyOwners(Region region) {
        if (region == null || region.getFailingUpkeeps().isEmpty()) {
            return;
        }
        if (!ConfigManager.getInstance().isRegionUpkeepChatTips()) {
            return;
        }
        long now = System.currentTimeMillis();
        long cooldownMs = ConfigManager.getInstance().getRegionUpkeepTipCooldownSeconds() * 1000L;
        String key = region.getId();
        Long last = LAST_NOTIFY_MS.get(key);
        if (last != null && now - last < cooldownMs) {
            return;
        }

        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(region.getType());
        List<String> missing = RegionChestUtil.summarizeMissingUpkeepMaterials(region, regionType);
        boolean outputFull = missing.isEmpty();
        String missingLabel = missing.isEmpty() ? "" : String.join(", ", missing);

        boolean sent = false;
        for (UUID ownerId : region.getOwners()) {
            Player owner = Bukkit.getPlayer(ownerId);
            if (owner == null || !owner.isOnline()) {
                continue;
            }
            String displayName = regionType != null ? regionType.getDisplayName(owner) : region.getType();
            String message;
            if (outputFull) {
                message = LocaleManager.getInstance()
                        .getTranslation(owner, "region-upkeep-output-full")
                        .replace("$1", displayName);
            } else {
                message = LocaleManager.getInstance()
                        .getTranslation(owner, "region-upkeep-missing")
                        .replace("$1", displayName)
                        .replace("$2", missingLabel);
            }
            owner.sendMessage(Civs.getPrefix() + message);
            sent = true;
        }
        if (sent) {
            LAST_NOTIFY_MS.put(key, now);
        }
    }

    /** Test helper. */
    static void clearCooldowns() {
        LAST_NOTIFY_MS.clear();
    }
}

package org.redcastlemedia.multitallented.civs.skills;

import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;
import java.util.regex.Pattern;

import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.stats.StatListener;
import org.redcastlemedia.multitallented.civs.stats.StatManager;
import org.redcastlemedia.multitallented.civs.stats.StatTotals;
import org.redcastlemedia.multitallented.civs.stats.TerritorialStat;
import org.redcastlemedia.multitallented.civs.util.FallbackConfigUtil;
import org.reflections.Reflections;
import org.reflections.ReflectionsException;
import org.reflections.scanners.ResourcesScanner;

import lombok.Getter;

@CivsSingleton(priority = CivsSingleton.SingletonLoadPriority.HIGHER)
public class SkillManager {
    private static SkillManager skillManager = null;

    @Getter
    private final HashMap<String, SkillType> skills = new HashMap<>();

    public static synchronized SkillManager getInstance() {
        if (skillManager == null) {
            skillManager = new SkillManager();
            skillManager.loadAllSkills();
        }
        return skillManager;
    }

    private void loadAllSkills() {
        final String SKILLS_FOLDER_NAME = "skills";
        File skillFolder = new File(Civs.dataLocation, SKILLS_FOLDER_NAME);
        boolean skillFolderExists = skillFolder.exists();
        String path = "resources." + ConfigManager.getInstance().getDefaultConfigSet() + "." + SKILLS_FOLDER_NAME;
        Reflections reflections = new Reflections(path , new ResourcesScanner());
        try {
            for (String fileName : reflections.getResources(Pattern.compile(".*\\.yml"))) {
                FileConfiguration config;
                if (skillFolderExists) {
                    config = FallbackConfigUtil.getConfigFullPath(
                            new File(skillFolder, fileName), "/" + fileName);
                } else {
                    config = FallbackConfigUtil.getConfigFullPath(null, "/" + fileName);
                }
                loadSkillType(config, fileName.substring(fileName.lastIndexOf("/") + 1).replace(".yml", ""));
            }
        } catch (ReflectionsException reflectionsException) {
            Civs.logger.log(Level.WARNING, "No Skill types found");
        }
        if (skillFolderExists) {
            for (File file : skillFolder.listFiles()) {
                String skillName = file.getName().replace(".yml", "");
                if (skills.containsKey(skillName)) {
                    continue;
                }
                FileConfiguration config = new YamlConfiguration();
                try {
                    config.load(file);
                } catch (Exception e) {
                    Civs.logger.severe("Unable to load " + file.getName());
                    continue;
                }
                loadSkillType(config, skillName);
            }
        }
    }

    private void loadSkillType(FileConfiguration config, String skillName) {
        if (!config.getBoolean("enabled")) {
            return;
        }
        skillName = skillName.toLowerCase();
        SkillType skillType = new SkillType(skillName,
                config.getString("icon", "STONE"));
        skillType.setExpPerCategory(config.getDouble("exp-per-new-item", 100));
        skillType.setExpRepeatDecay(config.getDouble("exp-repeat-decay", 20));
        skillType.setMaxExp(config.getDouble("max-exp", 2000));
        if (config.isSet("shop-rewards")) {
            Map<String, Double> shopRewards = new HashMap<>();
            for (String key : config.getConfigurationSection("shop-rewards").getKeys(false)) {
                shopRewards.put(key, config.getDouble("shop-rewards." + key, 0.1));
            }
            skillType.setShopRewards(shopRewards);
        }
        if (config.isSet("exceptions")) {
            Map<String, Double> exceptions = new HashMap<>();
            for (String key : config.getConfigurationSection("exceptions").getKeys(false)) {
                exceptions.put(key, config.getDouble("exceptions." + key, skillType.getExpPerCategory()));
            }
            skillType.setExceptions(exceptions);
        }
        skills.put(skillName, skillType);
    }

    public SkillType getSkillType(String name) {
        return skills.get(name.toLowerCase());
    }

    public int getShopTierCap(Civilian civilian) {
        Skill building = civilian.getSkills().get(CivSkills.BUILDING.name().toLowerCase());
        if (building == null) {
            return 1;
        }
        int tier = building.getLevel();
        if (tier < 1) {
            return 1;
        }
        int maxLevels = ConfigManager.getInstance().getLevelList().size();
        return maxLevels > 0 ? Math.min(tier, maxLevels) : tier;
    }

    public boolean isShopItemAvailable(Civilian civilian, CivItem civItem) {
        if (!civItem.getInShop()) {
            return true;
        }
        if (civItem.getItemType() == CivItem.ItemType.FOLDER
                || civItem.getItemType() == CivItem.ItemType.TOWN
                || !civItem.getGroups().contains("shop")) {
            return true;
        }
        int shopTier = getShopTierCap(civilian);
        if (civItem.getLevel() > shopTier) {
            return false;
        }
        if (civItem.getLevel() < shopTier) {
            return false;
        }
        return true;
    }

    public double getSkillDiscountedPrice(Civilian civilian, CivItem civItem) {
        double discount = 0;
        for (Skill skill : civilian.getSkills().values()) {
            SkillType skillType = skills.get(skill.getType());
            for (Map.Entry<String, Double> entry : skillType.getShopRewards().entrySet()) {
                String processedName = civItem.getProcessedName();
                if (processedName.equals(entry.getKey()) ||
                        civItem.getGroups().contains(entry.getKey())) {
                    double exp = skill.getTotalExp();
                    discount += entry.getValue() * exp / skillType.getMaxExp();
                }
            }
        }
        double priceMultiplier = 1.0 - discount;
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player != null && player.getLocation().getWorld() != null
                && StatListener.isInFriendlyTerritory(player, player.getLocation())) {
            StatTotals shopTotals = StatManager.getInstance()
                    .getStatTotals(civilian.getUuid(), TerritorialStat.SHOP_DISCOUNT);
            priceMultiplier = (priceMultiplier - shopTotals.getAddTotal()) * shopTotals.getMultiplyTotal();
        }
        return Math.max(0, priceMultiplier * civItem.getRawPrice());
    }
}

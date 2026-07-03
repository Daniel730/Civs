package org.redcastlemedia.multitallented.civs.mobs;

import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.logging.Level;
import java.util.regex.Pattern;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.util.FallbackConfigUtil;
import org.reflections.Reflections;
import org.reflections.ReflectionsException;
import org.reflections.scanners.ResourcesScanner;

@CivsSingleton(priority = CivsSingleton.SingletonLoadPriority.HIGH)
public class CustomMobManager {
    private static CustomMobManager instance;
    private static final ThreadLocal<Boolean> PLUGIN_SPAWN = ThreadLocal.withInitial(() -> false);
    private final Map<String, CustomMobDefinition> mobs = new HashMap<>();
    private final Random random = new Random();

    /** True while Civs is spawning a custom mob (bypasses deny_mob_spawn protection). */
    public static boolean isPluginSpawning() {
        return Boolean.TRUE.equals(PLUGIN_SPAWN.get());
    }

    public static CustomMobManager getInstance() {
        if (instance == null) {
            instance = new CustomMobManager();
            if (Civs.getInstance() != null) {
                CustomMobKeys.init(Civs.getInstance());
                instance.loadAllMobs();
            }
        }
        return instance;
    }

    public void reload() {
        mobs.clear();
        loadAllMobs();
    }

    public boolean isEnabled() {
        return ConfigManager.getInstance().isUseCustomMobs();
    }

    public CustomMobDefinition getMob(String mobId) {
        if (mobId == null) {
            return null;
        }
        return mobs.get(mobId.toLowerCase());
    }

    public Collection<String> getMobIds() {
        List<String> ids = new ArrayList<>(mobs.keySet());
        Collections.sort(ids);
        return ids;
    }

    public LivingEntity spawn(String mobId, Location location) {
        if (!isEnabled() || location == null || location.getWorld() == null) {
            return null;
        }
        CustomMobDefinition definition = getMob(mobId);
        if (definition == null) {
            return null;
        }
        Location spawnLocation = findSafeSpawn(location);
        PLUGIN_SPAWN.set(true);
        Entity entity;
        try {
            entity = spawnLocation.getWorld().spawnEntity(spawnLocation, definition.getEntityType());
        } finally {
            PLUGIN_SPAWN.set(false);
        }
        if (!(entity instanceof LivingEntity living)) {
            entity.remove();
            return null;
        }
        applyDefinition(living, definition);
        living.setRemoveWhenFarAway(false);
        living.setPersistent(true);
        MobSpawnFeedback.onSpawn(living, definition);
        scheduleDespawn(living, definition);
        return living;
    }

    private void scheduleDespawn(LivingEntity living, CustomMobDefinition definition) {
        int seconds = definition.getDespawnSeconds();
        if (seconds <= 0) {
            return;
        }
        Bukkit.getScheduler().runTaskLater(Civs.getInstance(), () -> {
            if (living.isValid() && !living.isDead()) {
                living.remove();
            }
        }, seconds * 20L);
    }

    private Location findSafeSpawn(Location origin) {
        Location base = origin.clone();
        base.setX(Math.floor(base.getX()) + 0.5);
        base.setZ(Math.floor(base.getZ()) + 0.5);
        for (int yOffset = 0; yOffset <= 2; yOffset++) {
            Location candidate = base.clone().add(0, yOffset, 0);
            if (isSpawnable(candidate)) {
                return candidate;
            }
        }
        return base.clone().add(0, 1, 0);
    }

    private static boolean isSpawnable(Location location) {
        if (location.getWorld() == null) {
            return false;
        }
        Block feet = location.getBlock();
        Block head = feet.getRelative(0, 1, 0);
        return !feet.getType().isSolid() && !head.getType().isSolid();
    }

    void applyDefinition(LivingEntity living, CustomMobDefinition definition) {
        living.getAttribute(Attribute.MAX_HEALTH).setBaseValue(definition.getHealth());
        living.setHealth(definition.getHealth());
        if (definition.getDamage() > 0) {
            var attackDamage = living.getAttribute(Attribute.ATTACK_DAMAGE);
            if (attackDamage != null) {
                attackDamage.setBaseValue(definition.getDamage());
            }
        }
        String displayName = resolveDisplayName(definition.getDisplay());
        living.setCustomName(ChatColor.translateAlternateColorCodes('&', displayName));
        living.setCustomNameVisible(true);
        CustomMobKeys.writeMobId(living, definition.getId());
    }

    public List<ItemStack> rollDrops(CustomMobDefinition definition) {
        List<ItemStack> drops = new ArrayList<>();
        for (CustomMobDrop drop : definition.getDrops()) {
            if (drop.getChance() < 1.0 && random.nextDouble() > drop.getChance()) {
                continue;
            }
            int amount = drop.getMinAmount();
            if (drop.getMaxAmount() > drop.getMinAmount()) {
                amount = drop.getMinAmount() + random.nextInt(drop.getMaxAmount() - drop.getMinAmount() + 1);
            }
            if (amount > 0) {
                drops.add(new ItemStack(drop.getMaterial(), amount));
            }
        }
        return drops;
    }

    private String resolveDisplayName(String displayKey) {
        String translated = LocaleManager.getInstance().getTranslation(
                ConfigManager.getInstance().getDefaultLanguage(), displayKey);
        if (translated == null || translated.isEmpty() || translated.equals(displayKey)) {
            return displayKey;
        }
        return translated;
    }

    private void loadAllMobs() {
        final String folderName = "mobs";
        File mobFolder = new File(Civs.dataLocation, folderName);
        boolean mobFolderExists = mobFolder.exists();
        String path = "resources." + ConfigManager.getInstance().getDefaultConfigSet() + "." + folderName;
        Reflections reflections = new Reflections(path, new ResourcesScanner());
        try {
            for (String fileName : reflections.getResources(Pattern.compile(".*\\.yml"))) {
                FileConfiguration config;
                if (mobFolderExists) {
                    config = FallbackConfigUtil.getConfigFullPath(new File(mobFolder, fileName), "/" + fileName);
                } else {
                    config = FallbackConfigUtil.getConfigFullPath(null, "/" + fileName);
                }
                String mobName = fileName.substring(fileName.lastIndexOf('/') + 1).replace(".yml", "");
                loadMob(config, mobName);
            }
        } catch (ReflectionsException reflectionsException) {
            Civs.logger.log(Level.FINE, "No bundled custom mob definitions found");
        }
        if (mobFolderExists) {
            File[] files = mobFolder.listFiles();
            if (files == null) {
                return;
            }
            for (File file : files) {
                if (!file.getName().endsWith(".yml")) {
                    continue;
                }
                String mobName = file.getName().replace(".yml", "");
                if (mobs.containsKey(mobName.toLowerCase())) {
                    continue;
                }
                FileConfiguration config = new YamlConfiguration();
                try {
                    config.load(file);
                } catch (Exception e) {
                    Civs.logger.severe("Unable to load custom mob " + file.getName());
                    continue;
                }
                loadMob(config, mobName);
            }
        }
        Civs.logger.log(Level.INFO, "Loaded {0} custom mob definition(s)", mobs.size());
    }

    private void loadMob(FileConfiguration config, String fileId) {
        try {
            CustomMobDefinition definition = CustomMobDefinition.fromConfig(config, fileId);
            if (definition == null) {
                return;
            }
            mobs.put(definition.getId(), definition);
        } catch (Exception ex) {
            Civs.logger.log(Level.SEVERE, "Failed to load custom mob " + fileId, ex);
        }
    }
}

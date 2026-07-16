package org.redcastlemedia.multitallented.civs.npc;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Villager;
import org.bukkit.scheduler.BukkitTask;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.util.FallbackConfigUtil;

import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@CivsSingleton(priority = CivsSingleton.SingletonLoadPriority.HIGH)
public class GuideNpcManager {
    private static GuideNpcManager instance;
    private final Map<String, GuideNpcDefinition> guides = new HashMap<>();
    private final Map<String, UUID> spawned = new HashMap<>();
    private BukkitTask pendingSpawnTask;

    public static GuideNpcManager getInstance() {
        if (instance == null) {
            instance = new GuideNpcManager();
            if (Civs.getInstance() != null) {
                GuideNpcKeys.init(Civs.getInstance());
                instance.loadGuides();
                instance.spawnAll();
            }
        }
        return instance;
    }

    public void reload() {
        despawnAll();
        guides.clear();
        loadGuides();
        spawnAll();
    }

    public GuideNpcDefinition getGuide(String guideId) {
        if (guideId == null) {
            return null;
        }
        return guides.get(guideId.toLowerCase(Locale.ROOT));
    }

    public Collection<GuideNpcDefinition> getAllGuides() {
        return Collections.unmodifiableCollection(guides.values());
    }

    private void loadGuides() {
        File dataFolder = Civs.dataLocation;
        File guidesFile = new File(dataFolder, "npc/guides.yml");
        FileConfiguration config = FallbackConfigUtil.getConfig(guidesFile, "npc/guides.yml");
        ConfigurationSection section = config.getConfigurationSection("guides");
        if (section == null) {
            return;
        }
        for (String key : section.getKeys(false)) {
            ConfigurationSection guideSection = section.getConfigurationSection(key);
            if (guideSection == null) {
                continue;
            }
            String id = guideSection.getString("id", key);
            String name = guideSection.getString("name", id);
            String world = guideSection.getString("world", "world");
            double x = guideSection.getDouble("x", 0);
            double y = guideSection.getDouble("y", 64);
            double z = guideSection.getDouble("z", 0);
            float yaw = (float) guideSection.getDouble("yaw", 0);
            Villager.Profession profession = Villager.Profession.NONE;
            try {
                profession = Villager.Profession.valueOf(
                        guideSection.getString("profession", "NONE").toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException ignored) {
                // keep NONE
            }
            String archetype = guideSection.getString("archetype", "neutral");
            List<String> dialog = guideSection.getStringList("dialog");
            guides.put(id.toLowerCase(Locale.ROOT),
                    new GuideNpcDefinition(id, name, world, x, y, z, yaw, profession, archetype, dialog));
        }
        Civs.logger.info("Loaded " + guides.size() + " guide NPCs.");
    }

    public void spawnAll() {
        if (Civs.getInstance() == null) {
            return;
        }
        if (pendingSpawnTask != null) {
            pendingSpawnTask.cancel();
            pendingSpawnTask = null;
        }
        pendingSpawnTask = Bukkit.getScheduler().runTaskLater(Civs.getInstance(), () -> {
            pendingSpawnTask = null;
            // Sweep orphans again in case another plugin/console spawned tagged villagers.
            removeOrphanedGuideEntities();
            for (GuideNpcDefinition guide : guides.values()) {
                spawnGuide(guide);
            }
        }, 40L);
    }

    private void spawnGuide(GuideNpcDefinition guide) {
        Location location = guide.toLocation();
        if (location == null || location.getWorld() == null) {
            Civs.logger.warning("Guide NPC world missing for " + guide.getId());
            return;
        }
        despawnGuide(guide.getId());
        Villager villager = location.getWorld().spawn(location, Villager.class, entity -> {
            entity.setAI(false);
            entity.setInvulnerable(true);
            entity.setSilent(true);
            entity.setCollidable(false);
            entity.setRemoveWhenFarAway(false);
            entity.setProfession(guide.getProfession());
            entity.setCustomNameVisible(true);
            entity.customName(net.kyori.adventure.text.Component.text(guide.getDisplayName()));
            GuideNpcKeys.writeGuideId(entity, guide.getId());
        });
        spawned.put(guide.getId().toLowerCase(Locale.ROOT), villager.getUniqueId());
    }

    private void despawnGuide(String guideId) {
        String key = guideId.toLowerCase(Locale.ROOT);
        UUID existing = spawned.remove(key);
        if (existing != null) {
            for (World world : Bukkit.getWorlds()) {
                Entity entity = world.getEntity(existing);
                if (entity != null) {
                    entity.remove();
                    break;
                }
            }
        }
        // Also remove any duplicate/orphaned villagers tagged with this guide id.
        for (World world : Bukkit.getWorlds()) {
            for (Villager villager : world.getEntitiesByClass(Villager.class)) {
                String tagged = GuideNpcKeys.readGuideId(villager);
                if (key.equals(tagged)) {
                    villager.remove();
                }
            }
        }
    }

    private void despawnAll() {
        if (pendingSpawnTask != null) {
            pendingSpawnTask.cancel();
            pendingSpawnTask = null;
        }
        List<String> ids = new ArrayList<>(spawned.keySet());
        for (String id : ids) {
            despawnGuide(id);
        }
        removeOrphanedGuideEntities();
    }

    /**
     * Removes every villager tagged as a Civs guide NPC, including orphans left after
     * failed despawns or overlapping deferred {@link #spawnAll()} tasks.
     */
    void removeOrphanedGuideEntities() {
        for (World world : Bukkit.getWorlds()) {
            for (Villager villager : world.getEntitiesByClass(Villager.class)) {
                if (GuideNpcKeys.readGuideId(villager) != null) {
                    villager.remove();
                }
            }
        }
        spawned.clear();
    }

    /** Exposed for unit tests — whether a deferred spawn is queued. */
    boolean hasPendingSpawnTask() {
        return pendingSpawnTask != null;
    }

    int trackedSpawnCount() {
        return spawned.size();
    }
}

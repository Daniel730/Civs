package org.redcastlemedia.multitallented.civs.skills;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.data.BlockData;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.regions.effects.RepairEffect;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsSingleton
public class SkillListener implements Listener {

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new SkillListener(), Civs.getInstance());
    }

    @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
    public void onBlockBreak(BlockBreakEvent event) {
        if (!ConfigManager.getInstance().isUseSkills() ||
                Util.isDisallowedByWorld(event.getBlock().getWorld().getName()) ||
                event.getPlayer().getGameMode() != GameMode.SURVIVAL) {
            return;
        }
        Player player = event.getPlayer();
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        Material type = event.getBlock().getType();
        if (isOre(type)) {
            ItemStack mainItem = player.getInventory().getItemInMainHand();
            if (!mainItem.containsEnchantment(Enchantment.SILK_TOUCH)) {
                civilian.awardSkill(player, type.name(), CivSkills.MINING.name());
            }
            return;
        }
        if (isHarvestableCrop(event.getBlock())) {
            civilian.awardSkill(player, type.name(), CivSkills.FOOD.name());
        }
    }

    @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
    public void onPlayerFish(PlayerFishEvent event) {
        if (!ConfigManager.getInstance().isUseSkills() ||
                Util.isDisallowedByWorld(event.getPlayer().getWorld().getName()) ||
                event.getPlayer().getGameMode() != GameMode.SURVIVAL ||
                event.getState() != PlayerFishEvent.State.CAUGHT_FISH ||
                event.getCaught() == null) {
            return;
        }
        Player player = event.getPlayer();
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        String caughtName = event.getCaught() instanceof Item caughtItem
                ? caughtItem.getItemStack().getType().name()
                : event.getCaught().getType().name();
        civilian.awardSkill(player, caughtName, CivSkills.FISHING.name());
    }

    @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
    public void onEntityDeath(EntityDeathEvent event) {
        if (!ConfigManager.getInstance().isUseSkills() ||
                Util.isDisallowedByWorld(event.getEntity().getWorld().getName()) ||
                event.getEntity().getKiller() == null) {
            return;
        }
        Player player = event.getEntity().getKiller();
        if (player.getGameMode() != GameMode.SURVIVAL ||
                (Civs.perm != null && Civs.perm.has(player, Constants.ADMIN_PERMISSION))) {
            return;
        }
        ItemStack mainHand = player.getInventory().getItemInMainHand();
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        String mobType = event.getEntity().getType().name();
        if (RepairEffect.isSword(mainHand.getType())) {
            civilian.awardSkill(player, mobType, CivSkills.SWORD.name());
        } else if (RepairEffect.isAxe(mainHand.getType())) {
            civilian.awardSkill(player, mobType, CivSkills.AXE.name());
        } else if (mainHand.getType() == Material.TRIDENT) {
            civilian.awardSkill(player, mobType, CivSkills.TRIDENT.name());
        } else if (mainHand.getType() == Material.BOW) {
            civilian.awardSkill(player, mobType, CivSkills.BOW.name());
        } else if (mainHand.getType() == Material.CROSSBOW) {
            civilian.awardSkill(player, mobType, CivSkills.CROSSBOW.name());
        }
    }

    private boolean isOre(Material type) {
        switch (type) {
            case COPPER_ORE:
            case COAL_ORE:
            case IRON_ORE:
            case DIAMOND_ORE:
            case GOLD_ORE:
            case REDSTONE_ORE:
            case EMERALD_ORE:
            case LAPIS_ORE:
            case NETHER_QUARTZ_ORE:
            case GLOWSTONE:
            case DEEPSLATE_COAL_ORE:
            case DEEPSLATE_COPPER_ORE:
            case DEEPSLATE_DIAMOND_ORE:
            case DEEPSLATE_GOLD_ORE:
            case DEEPSLATE_LAPIS_ORE:
            case DEEPSLATE_EMERALD_ORE:
            case DEEPSLATE_REDSTONE_ORE:
            case DEEPSLATE_IRON_ORE:
                return true;
            default:
                return false;
        }
    }

    private boolean isHarvestableCrop(Block block) {
        Material type = block.getType();
        if (type == Material.MELON || type == Material.PUMPKIN ||
                type == Material.SUGAR_CANE || type == Material.CACTUS ||
                type == Material.BAMBOO || type == Material.NETHER_WART ||
                type == Material.COCOA || type == Material.SWEET_BERRY_BUSH) {
            return true;
        }
        BlockData blockData = block.getBlockData();
        if (!(blockData instanceof Ageable)) {
            return false;
        }
        Ageable ageable = (Ageable) blockData;
        return ageable.getAge() >= ageable.getMaximumAge();
    }
}

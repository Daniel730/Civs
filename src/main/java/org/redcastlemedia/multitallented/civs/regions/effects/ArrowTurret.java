package org.redcastlemedia.multitallented.civs.regions.effects;

import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.*;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.BlockIterator;
import org.bukkit.util.Vector;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.events.PlayerInRegionEvent;
import org.redcastlemedia.multitallented.civs.events.RegionTickEvent;
import org.redcastlemedia.multitallented.civs.items.CVInventory;
import org.redcastlemedia.multitallented.civs.items.UnloadedInventoryHandler;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.mobs.CustomMobKeys;
import org.redcastlemedia.multitallented.civs.spells.effects.DamageEffect;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.util.Util;

import java.util.*;

import static org.redcastlemedia.multitallented.civs.util.Util.isLocationWithinSightOfPlayer;

@CivsSingleton
public class ArrowTurret implements Listener {
    public static final String KEY = "arrow_turret";
    public static final String DAMAGE_KEY = "damage_turret";
    public static final HashMap<Arrow, Integer> arrowDamages = new HashMap<>();

    public static void getInstance() {
        Bukkit.getPluginManager().registerEvents(new ArrowTurret(), Civs.getInstance());
    }

    private static boolean turretsEnabled() {
        return ConfigManager.getInstance().isUseTurrets();
    }

    @EventHandler
    public void onRegionTickEvent(RegionTickEvent event) {
        if (!turretsEnabled()) {
            return;
        }
        Region region = event.getRegion();
        RegionType regionType = event.getRegionType();
        if (!isLocationWithinSightOfPlayer(region.getLocation())) {
            return;
        }

        String damageVars = region.getEffects().get(DAMAGE_KEY);
        if (damageVars != null) {
            LivingEntity target = findHostileTarget(region, regionType);
            if (target != null) {
                applyDirectDamage(region, target, damageVars, false);
            }
            return;
        }

        if (ConfigManager.getInstance().getDenyArrowTurretShootAtMobs()
                || !region.getEffects().containsKey(KEY)) {
            return;
        }

        LivingEntity target = findHostileTarget(region, regionType);
        if (target != null) {
            shootArrow(region, target, region.getEffects().get(KEY), false);
        }
    }

    public static void shootArrow(Region r, UUID uuid, String vars, boolean runUpkeep) {
        shootArrow(r, Bukkit.getPlayer(uuid), vars, runUpkeep);
    }

    public static void shootArrow(Region r, LivingEntity livingEntity, String vars, boolean runUpkeep) {
        if (!turretsEnabled() || livingEntity == null) {
            return;
        }
        Location l = r.getLocation();
        if (!Util.isChunkLoadedAt(r.getLocation()) || !Util.isChunkLoadedAt(livingEntity.getLocation())) {
            return;
        }

        TurretParams params = TurretParams.parse(vars);
        if (params == null) {
            return;
        }
        int damage = params.getDamagePercent();
        double speed = params.getSpeed();
        int spread = params.getSpread();

        if (l.getBlock().getRelative(BlockFace.UP).getType() != Material.AIR
                || l.getBlock().getRelative(BlockFace.UP, 2).getType() != Material.AIR) {
            return;
        }

        purgeDeadArrows();

        if (livingEntity instanceof Player) {
            Player player = (Player) livingEntity;
            if (player.getGameMode() != GameMode.SURVIVAL && player.getGameMode() != GameMode.ADVENTURE) {
                return;
            }
        }

        if (isProtectedFromTurret(r, livingEntity)) {
            return;
        }

        if (runUpkeep && !r.runUpkeep(false)) {
            return;
        }

        CVInventory cvInventory = UnloadedInventoryHandler.getInstance().getChestInventory(l);
        cvInventory.removeItem(new ItemStack(Material.ARROW));

        purgeGroundedArrows();

        Location loc = l.getBlock().getRelative(BlockFace.UP, 2).getLocation();
        Location targetLoc = livingEntity.getEyeLocation();
        Vector vel = new Vector(
                targetLoc.getX() - loc.getX(),
                targetLoc.getY() - loc.getY(),
                targetLoc.getZ() - loc.getZ());

        Arrow arrow = l.getWorld().spawnArrow(loc, vel, (float) speed, spread);
        arrowDamages.put(arrow, damage);
    }

    @EventHandler
    public void onPlayerInRegion(PlayerInRegionEvent event) {
        if (!turretsEnabled()) {
            return;
        }
        Region region = event.getRegion();
        String damageVars = region.getEffects().get(DAMAGE_KEY);
        if (damageVars != null) {
            Player player = Bukkit.getPlayer(event.getUuid());
            if (player != null) {
                applyDirectDamage(region, player, damageVars, true);
            }
            return;
        }
        if (region.getEffects().containsKey(KEY)) {
            shootArrow(region, event.getUuid(), region.getEffects().get(KEY), true);
        }
    }

    @EventHandler
    public void onEntityDamageByEntityEvent(EntityDamageByEntityEvent event) {
        if (event.isCancelled()) {
            return;
        }
        Entity projectile = event.getDamager();
        if (!(projectile instanceof Arrow) || !(event.getEntity() instanceof LivingEntity)) {
            return;
        }
        Arrow arrow = (Arrow) projectile;
        Integer storedDamage = arrowDamages.get(arrow);
        if (storedDamage == null) {
            return;
        }

        LivingEntity damagee = (LivingEntity) event.getEntity();
        double maxHp = damagee.getAttribute(Attribute.MAX_HEALTH).getValue();
        int damage = (int) ((double) storedDamage / 100.0 * maxHp);
        arrowDamages.remove(arrow);
        if (damagee instanceof Player) {
            damage = DamageEffect.adjustForArmor(damage, (Player) damagee);
        }
        event.setDamage(damage);
    }

    private static void applyDirectDamage(Region region, LivingEntity target, String vars, boolean runUpkeep) {
        if (!turretsEnabled() || target == null) {
            return;
        }
        if (!Util.isChunkLoadedAt(region.getLocation()) || !Util.isChunkLoadedAt(target.getLocation())) {
            return;
        }
        if (target instanceof Player) {
            Player player = (Player) target;
            if (player.getGameMode() != GameMode.SURVIVAL && player.getGameMode() != GameMode.ADVENTURE) {
                return;
            }
        }
        if (isProtectedFromTurret(region, target)) {
            return;
        }
        if (runUpkeep && !region.runUpkeep(false)) {
            return;
        }

        int damagePercent = TurretParams.parseDamagePercent(vars);
        if (damagePercent <= 0) {
            return;
        }

        double maxHp = target.getAttribute(Attribute.MAX_HEALTH).getValue();
        double damage = (double) damagePercent / 100.0 * maxHp;
        if (target instanceof Player) {
            damage = DamageEffect.adjustForArmor((int) damage, (Player) target);
        }
        if (damage > 0) {
            target.damage(damage);
        }
    }

    private static LivingEntity findHostileTarget(Region region, RegionType regionType) {
        Location location = region.getLocation();
        double radius = regionType.getEffectRadius();
        for (Entity entity : location.getWorld().getNearbyEntities(location, radius, radius, radius)) {
            if (!(entity instanceof LivingEntity) || !isHostileMob(entity)) {
                continue;
            }
            LivingEntity living = (LivingEntity) entity;
            if (living.getLocation().distance(location) > radius) {
                continue;
            }
            if (isProtectedFromTurret(region, living)) {
                continue;
            }
            return living;
        }
        return null;
    }

    private static boolean isProtectedFromTurret(Region region, LivingEntity entity) {
        if (!(entity instanceof Player player)) {
            return false;
        }
        if (region.getPeople().containsKey(player.getUniqueId())) {
            return true;
        }
        Town town = TownManager.getInstance().getTownAt(region.getLocation());
        return town != null && town.getPeople().containsKey(player.getUniqueId());
    }

    private static boolean isHostileMob(Entity entity) {
        if (entity instanceof LivingEntity living && CustomMobKeys.readMobId(living) != null) {
            return false;
        }
        return entity instanceof Monster || entity instanceof Phantom || entity instanceof Slime;
    }

    private static void purgeDeadArrows() {
        HashSet<Arrow> removeMe = new HashSet<>();
        for (Arrow arrow : arrowDamages.keySet()) {
            if (arrow.isDead() || !arrow.isValid()) {
                removeMe.add(arrow);
            }
        }
        for (Arrow arrow : removeMe) {
            arrow.remove();
            arrowDamages.remove(arrow);
        }
    }

    private static void purgeGroundedArrows() {
        HashSet<Arrow> arrows = new HashSet<>();
        for (Arrow arrow : arrowDamages.keySet()) {
            if (arrow.isDead() || arrow.isOnGround() || !arrow.isValid()) {
                arrows.add(arrow);
            }
        }
        for (Arrow arrow : arrows) {
            arrowDamages.remove(arrow);
        }
    }

    @SuppressWarnings("unused")
    private boolean hasCleanShot(Location shootHere, Location targetHere) {
        Vector start = new Vector(shootHere.getX(), shootHere.getY(), shootHere.getZ());
        Vector end = new Vector(targetHere.getX(), targetHere.getY(), targetHere.getZ());

        BlockIterator bi = new BlockIterator(shootHere.getWorld(), start, end, 0,
                (int) shootHere.distance(targetHere));
        while (bi.hasNext()) {
            Block block = bi.next();
            if (!Util.isSolidBlock(block.getType())) {
                return false;
            }
        }
        return true;
    }
}

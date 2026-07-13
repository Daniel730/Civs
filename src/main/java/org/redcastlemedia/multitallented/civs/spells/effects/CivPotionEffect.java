package org.redcastlemedia.multitallented.civs.spells.effects;

import org.bukkit.Bukkit;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.potion.PotionType;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.spells.Spell;
import org.redcastlemedia.multitallented.civs.spells.SpellConstants;
import org.redcastlemedia.multitallented.civs.spells.civstate.CivState;

import java.util.HashMap;

public class CivPotionEffect extends Effect {

    private PotionEffect potion;
    private PotionEffectType type;
    private int level = 1;
    private int ticks = 0;
    private ConfigurationSection config = null;

    private String target = "self";

    public CivPotionEffect(Spell spell, String key, Object target, Entity origin, int level, Object configSettings) {
        super(spell, key, target, origin, level);
        if (configSettings instanceof ConfigurationSection) {
            ConfigurationSection section = (ConfigurationSection) configSettings;
            this.type = PotionEffectType.getByName(section.getString("type", "POISON"));
            this.ticks = (int) Math.round(Spell.getLevelAdjustedValue("" +
                    section.getInt(SpellConstants.TICKS, 40), level, target, spell));
            this.level = (int) Math.round(Spell.getLevelAdjustedValue("" +
                    section.getInt(SpellConstants.LEVEL, 1), level, target, spell));
            String tempTarget = section.getString(SpellConstants.TARGET, SpellConstants.NOT_A_STRING);
            if (!SpellConstants.NOT_A_STRING.equals(tempTarget)) {
                this.target = tempTarget;
            } else {
                this.target = "self";
            }
            this.config = section;

            this.potion = new PotionEffect(type, ticks, this.level);
        } else if (configSettings instanceof String) {
            this.type = PotionEffectType.getByName((String) configSettings);
            this.ticks = 40;
            this.level = 1;
            this.target = "self";

            this.potion = new PotionEffect(type, ticks, this.level);
        }
    }

    @Override
    public boolean meetsRequirement() {
        Object target = getTarget();
        if (!(target instanceof LivingEntity)) {
            return false;
        }
        LivingEntity livingEntity = (LivingEntity) target;
        return livingEntity.hasPotionEffect(this.type);
    }

    @Override
    public void apply() {
        Object target = getTarget();
        if (!(target instanceof LivingEntity)) {
            return;
        }
        LivingEntity livingEntity = (LivingEntity) target;
        Player player = null;
        if (livingEntity instanceof Player) {
            player = (Player) livingEntity;
        }
        livingEntity.addPotionEffect(this.potion);
        if (player == null) {
            return;
        }
        Civilian champion1 = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        CivState state = champion1.getStates().get(getSpell().getType() + "." + super.getKey());
        if (state != null) {
            state.remove(champion1);
            champion1.getStates().remove(getSpell().getType() + "." + super.getKey());
        }
        HashMap<String, Object> variables = new HashMap<>();
        variables.put("ticks", this.ticks);
        variables.put("level", this.level);

        final Civilian champion = champion1;
        final String stateName = getSpell().getType() + "." + super.getKey();
        int durationId = Bukkit.getScheduler().scheduleSyncDelayedTask(Civs.getInstance(), new Runnable() {
            @Override
            public void run() {
                CivState cState = champion.getStates().get(stateName);
                if (cState != null) {
                    cState.remove(livingEntity);
                }
            }
        }, this.ticks);

        if (config != null) {
            state = new CivState(getSpell(), super.getKey(), durationId, -1, config, variables);
        } else {
            state = new CivState(getSpell(), super.getKey(), durationId, -1, "" + this.ticks, variables);
        }

        champion.getStates().put(stateName, state);
    }

    @Override
    public void remove(LivingEntity origin, int level, Spell spell) {
        origin.removePotionEffect(this.type);
    }

    @Override
    public HashMap<String, Double> getVariables(Object target, Entity origin, int level, Spell spell) {
        HashMap<String, Double> returnMap = new HashMap<>();
        if (!(target instanceof LivingEntity)) {
            return returnMap;
        }
        LivingEntity livingEntity = (LivingEntity) target;
        if (!livingEntity.hasPotionEffect(this.type)) {
            return returnMap;
        }
        for (PotionEffect potionEffect : livingEntity.getActivePotionEffects()) {
            if (potionEffect.getType().equals(this.type)) {
                returnMap.put("ticks", (double) potionEffect.getDuration());
                returnMap.put(SpellConstants.LEVEL, (double) potionEffect.getAmplifier());
                break;
            }
        }
        return returnMap;
    }

    private static final int MIN = 1200;
    public static PotionEffect getPotionEffect(PotionMeta pm) {
        PotionType pt = pm.getBasePotionType();
        if (pt == null) {
            return null;
        }
        PotionEffectType pet = primaryEffectType(pt);
        if (pet == null) {
            return null;
        }
        boolean extended = isExtendedPotionType(pt);
        boolean upgraded = isUpgradedPotionType(pt);
        boolean irregular = isIrregular(pet) || isIrregularPotionType(pt);
        boolean negative = isNegative(pet);
        String baseName = basePotionName(pt);


        if(!extended && !upgraded && !irregular) {
            return negative ? new PotionEffect(pet, (int) (MIN * 1.5), 0) : new PotionEffect(pet, MIN * 3, 0);
        }else if(!extended && upgraded && !irregular) {
            return negative ? new PotionEffect(pet, 400, 3) : new PotionEffect(pet, (int) (MIN * 1.5D), 1); // hard code slowness 4 in because its the only negative semi-irregular potion effect
        }else if(extended && !upgraded && !irregular) {
            return negative ? new PotionEffect(pet, MIN * 4, 0) : new PotionEffect(pet, MIN * 8, 0);
        }else if("REGENERATION".equals(baseName) || "POISON".equals(baseName)) {
            return extended ? new PotionEffect(pet, (int) (MIN * 1.5), 0) : upgraded ? negative ? new PotionEffect(pet, (int) (21.6 * 20), 1): new PotionEffect(pet, 22*20, 1) : new PotionEffect(pet, 45 * 20, 0) ;
        }else if(pet.isInstant() || isInstantEffect(pet) || "HEALING".equals(baseName) || "HARMING".equals(baseName)) {
            return upgraded ? new PotionEffect(pet, 1, 1) : new PotionEffect(pet, 1, 0);
        }else if("LUCK".equals(baseName)) {
            return new PotionEffect(pet, 5 * MIN, 0);
        }else if("TURTLE_MASTER".equals(baseName)) {
            return null; // make sure in your method you do something about this. Since turtle master gives two potion effects, you have to handle this outside of this method.
        }



        return new PotionEffect(pet, MIN, 0);
    }


    public static boolean isNegative(PotionEffectType pet) {
        if (pet == null) {
            return false;
        }
        String name = pet.getName();
        return "POISON".equals(name) || "SLOWNESS".equals(name) || "WEAKNESS".equals(name)
                || "SLOW_FALLING".equals(name) || "HARM".equals(name) || "INSTANT_DAMAGE".equals(name);
    }


    private static PotionType[] getNegativePotions() {
        // Slow falling is not a negative put has stats effects simular to a negative potion.
        return new PotionType[] {PotionType.HARMING, PotionType.POISON, PotionType.SLOWNESS, PotionType.WEAKNESS, PotionType.SLOW_FALLING};
    }

    public static boolean isIrregular(PotionEffectType pet) {
        if (pet == null) {
            return false;
        }
        String name = pet.getName();
        return "REGENERATION".equals(name) || "LUCK".equals(name) || "POISON".equals(name)
                || "TURTLE_MASTER".equals(name) || "HARM".equals(name) || "HEAL".equals(name)
                || "INSTANT_DAMAGE".equals(name) || "INSTANT_HEALTH".equals(name);
    }

    private static boolean isIrregularPotionType(PotionType potionType) {
        if (potionType == null) {
            return false;
        }
        String baseName = basePotionName(potionType);
        return "REGENERATION".equals(baseName) || "LUCK".equals(baseName) || "POISON".equals(baseName)
                || "TURTLE_MASTER".equals(baseName) || "HARMING".equals(baseName) || "HEALING".equals(baseName);
    }

    private static PotionType[] getIrregularPotions() {
        return new PotionType[] {PotionType.REGENERATION, PotionType.LUCK, PotionType.POISON, PotionType.TURTLE_MASTER, PotionType.HARMING, PotionType.HEALING};
    }

    public static boolean isUnusable(PotionType type) {
        for (PotionType pt: getUnusable()) {
            if (pt.equals(type)) {
                return true;
            }
        }
        return false;
    }


    private static PotionType[] getUnusable() {
        return new PotionType[] {PotionType.AWKWARD, PotionType.WATER, PotionType.THICK, PotionType.MUNDANE};
    }

    public static PotionEffectType getPrimaryEffectType(PotionMeta pm) {
        if (pm == null) {
            return null;
        }
        return primaryEffectType(pm.getBasePotionType());
    }

    public static boolean isUpgraded(PotionMeta pm) {
        if (pm == null) {
            return false;
        }
        PotionType pt = pm.getBasePotionType();
        return pt != null && isUpgradedPotionType(pt);
    }

    private static PotionEffectType primaryEffectType(PotionType potionType) {
        if (potionType == null) {
            return null;
        }
        try {
            if (!potionType.getPotionEffects().isEmpty()) {
                return potionType.getPotionEffects().get(0).getType();
            }
            return potionType.getEffectType();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean isInstantEffect(PotionEffectType pet) {
        if (pet == null) {
            return false;
        }
        String name = pet.getName();
        return "INSTANT_HEALTH".equals(name) || "INSTANT_DAMAGE".equals(name)
                || "HEAL".equals(name) || "HARM".equals(name);
    }

    private static boolean isExtendedPotionType(PotionType potionType) {
        return potionType.name().startsWith("LONG_");
    }

    private static boolean isUpgradedPotionType(PotionType potionType) {
        return potionType.name().startsWith("STRONG_");
    }

    private static String basePotionName(PotionType potionType) {
        String name = potionType.name();
        if (name.startsWith("LONG_")) {
            return name.substring(5);
        }
        if (name.startsWith("STRONG_")) {
            return name.substring(7);
        }
        return name;
    }
}

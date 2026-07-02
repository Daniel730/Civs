package org.redcastlemedia.multitallented.civs.registry;

import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;

import org.bukkit.GameRule;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Biome;
import org.bukkit.damage.DamageEffect;
import org.bukkit.damage.DamageSource;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Pose;

import com.destroystokyo.paper.SkinParts;

import io.papermc.paper.InternalAPIBridge;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.datacomponent.item.ResolvableProfile;
import io.papermc.paper.entity.poi.PoiType;
import io.papermc.paper.world.damagesource.CombatEntry;
import io.papermc.paper.world.damagesource.FallLocationType;
import net.kyori.adventure.text.Component;

/**
 * An {@link InternalAPIBridge} implementation loaded via
 * {@link java.util.ServiceLoader} (see
 * {@code META-INF/services/io.papermc.paper.InternalAPIBridge}) so unit
 * tests can resolve {@link Biome#CUSTOM}, which Paper constructs through
 * this bridge instead of the normal registry lookup used for every other
 * {@link Biome} constant.
 *
 * <p>Every other member of this bridge is internal machinery not exercised
 * by this project's unit tests, so it intentionally throws
 * {@link UnsupportedOperationException} if ever invoked, making any future
 * reliance on it fail loudly instead of silently returning bogus data.</p>
 */
public class FakeInternalAPIBridge implements InternalAPIBridge {
    @Override
    public Biome constructLegacyCustomBiome() {
        return FakeKeyedProxy.create(Biome.class, NamespacedKey.minecraft("custom"));
    }

    @Override
    public DamageEffect getDamageEffect(String s) {
        throw unsupported();
    }

    @Override
    public PoiType.Occupancy createOccupancy(String s) {
        throw unsupported();
    }

    @Override
    public CombatEntry createCombatEntry(LivingEntity livingEntity, DamageSource damageSource, float v) {
        throw unsupported();
    }

    @Override
    public CombatEntry createCombatEntry(DamageSource damageSource, float v, FallLocationType fallLocationType, float v1) {
        throw unsupported();
    }

    @Override
    public Predicate<CommandSourceStack> restricted(Predicate<CommandSourceStack> predicate) {
        throw unsupported();
    }

    @Override
    public ResolvableProfile defaultMannequinProfile() {
        throw unsupported();
    }

    @Override
    public SkinParts.Mutable allSkinParts() {
        throw unsupported();
    }

    @Override
    public Component defaultMannequinDescription() {
        throw unsupported();
    }

    @Override
    public <MODERN, LEGACY> GameRule<LEGACY> legacyGameRuleBridge(GameRule<MODERN> gameRule, Function<LEGACY, MODERN> function, Function<MODERN, LEGACY> function1, Class<LEGACY> aClass) {
        throw unsupported();
    }

    @Override
    public Set<Pose> validMannequinPoses() {
        throw unsupported();
    }

    private static UnsupportedOperationException unsupported() {
        return new UnsupportedOperationException(
                "Not implemented by FakeInternalAPIBridge (test-only stand-in for a running Paper server)");
    }
}

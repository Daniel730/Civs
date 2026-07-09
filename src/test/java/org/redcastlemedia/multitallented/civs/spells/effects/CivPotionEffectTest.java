package org.redcastlemedia.multitallented.civs.spells.effects;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;

import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.potion.PotionType;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;

public class CivPotionEffectTest extends TestUtil {

    @Test
    public void longSwiftnessShouldHaveExtendedDuration() {
        PotionMeta pm = mockPotionMeta(PotionType.LONG_SWIFTNESS, PotionEffectType.SPEED);

        PotionEffect effect = CivPotionEffect.getPotionEffect(pm);

        assertNotNull(effect);
        assertEquals(PotionEffectType.SPEED, effect.getType());
        assertEquals(1200 * 8, effect.getDuration());
        assertEquals(0, effect.getAmplifier());
    }

    @Test
    public void strongHealingShouldBeInstantAndAmplified() {
        PotionMeta pm = mockPotionMeta(PotionType.STRONG_HEALING, PotionEffectType.INSTANT_HEALTH);

        PotionEffect effect = CivPotionEffect.getPotionEffect(pm);

        assertNotNull(effect);
        assertEquals(PotionEffectType.INSTANT_HEALTH, effect.getType());
        assertEquals(1, effect.getDuration());
        assertEquals(1, effect.getAmplifier());
    }

    @Test
    public void longRegenerationShouldUseExtendedIrregularDuration() {
        PotionMeta pm = mockPotionMeta(PotionType.LONG_REGENERATION, PotionEffectType.REGENERATION);

        PotionEffect effect = CivPotionEffect.getPotionEffect(pm);

        assertNotNull(effect);
        assertEquals(PotionEffectType.REGENERATION, effect.getType());
        assertEquals((int) (1200 * 1.5), effect.getDuration());
        assertEquals(0, effect.getAmplifier());
    }

    @Test
    public void strongRegenerationShouldUseUpgradedIrregularDuration() {
        PotionMeta pm = mockPotionMeta(PotionType.STRONG_REGENERATION, PotionEffectType.REGENERATION);

        PotionEffect effect = CivPotionEffect.getPotionEffect(pm);

        assertNotNull(effect);
        assertEquals(PotionEffectType.REGENERATION, effect.getType());
        assertEquals(22 * 20, effect.getDuration());
        assertEquals(1, effect.getAmplifier());
    }

    @Test
    public void baseRegenerationShouldUseDefaultIrregularDuration() {
        PotionMeta pm = mockPotionMeta(PotionType.REGENERATION, PotionEffectType.REGENERATION);

        PotionEffect effect = CivPotionEffect.getPotionEffect(pm);

        assertNotNull(effect);
        assertEquals(PotionEffectType.REGENERATION, effect.getType());
        assertEquals(45 * 20, effect.getDuration());
        assertEquals(0, effect.getAmplifier());
    }

    @Test
    public void primaryEffectTypeShouldUseBasePotionType() {
        PotionMeta pm = mockPotionMeta(PotionType.STRONG_POISON, PotionEffectType.POISON);

        assertEquals(PotionEffectType.POISON, CivPotionEffect.getPrimaryEffectType(pm));
        assertEquals(true, CivPotionEffect.isUpgraded(pm));
    }

    @Test
    public void nullBasePotionTypeShouldReturnNullEffect() {
        PotionMeta pm = mock(PotionMeta.class);
        when(pm.getBasePotionType()).thenReturn(null);
        when(pm.getCustomEffects()).thenReturn(Collections.emptyList());

        assertNull(CivPotionEffect.getPotionEffect(pm));
        assertNull(CivPotionEffect.getPrimaryEffectType(pm));
        assertEquals(false, CivPotionEffect.isUpgraded(pm));
    }

    private static PotionMeta mockPotionMeta(PotionType potionType, PotionEffectType effectType) {
        PotionType typeMock = mock(PotionType.class);
        when(typeMock.name()).thenReturn(potionType.name());
        when(typeMock.getPotionEffects()).thenReturn(List.of(new PotionEffect(effectType, 1, 0)));

        PotionMeta pm = mock(PotionMeta.class);
        when(pm.getBasePotionType()).thenReturn(typeMock);
        return pm;
    }
}

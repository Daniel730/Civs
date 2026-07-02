package org.redcastlemedia.multitallented.civs.registry;

import java.util.IdentityHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.bukkit.Keyed;
import org.bukkit.Registry;
import org.bukkit.attribute.Attribute;
import org.bukkit.block.Biome;
import org.bukkit.block.banner.PatternType;
import org.bukkit.damage.DamageType;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemType;
import org.bukkit.inventory.MenuType;
import org.bukkit.inventory.meta.trim.TrimMaterial;
import org.bukkit.inventory.meta.trim.TrimPattern;
import org.bukkit.potion.PotionEffectType;

import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;

/**
 * A {@link RegistryAccess} implementation loaded via {@link java.util.ServiceLoader}
 * (see {@code META-INF/services/io.papermc.paper.registry.RegistryAccess}) so
 * that unit tests can resolve Paper's registry-backed pseudo-enum constants
 * (e.g. {@link Biome#BADLANDS}) without a running Paper server.
 *
 * <p>Real Paper servers back {@link RegistryAccess} with the actual vanilla
 * data-driven registries. Since no such server exists in this project's unit
 * tests, this class hands out {@link FakeRegistry} instances that manufacture
 * a stable, key-identified stand-in object on first lookup (see
 * {@link FakeKeyedProxy}). Tests in this project only ever compare/assign
 * these constants (e.g. {@code Biome.BADLANDS}), so this is sufficient
 * without needing a full vanilla data implementation.</p>
 */
public class FakeRegistryAccess implements RegistryAccess {
    private static final Map<RegistryKey<?>, Class<? extends Keyed>> KEY_TO_TYPE = new IdentityHashMap<>();

    static {
        // Only registries actually touched by this project's manual test mocks
        // are mapped here. If a test starts touching a different registry-backed
        // constant, add its RegistryKey/Class pair below.
            KEY_TO_TYPE.put(RegistryKey.BIOME, Biome.class);
            KEY_TO_TYPE.put(RegistryKey.ITEM, ItemType.class);
        KEY_TO_TYPE.put(RegistryKey.ATTRIBUTE, Attribute.class);
        KEY_TO_TYPE.put(RegistryKey.MOB_EFFECT, PotionEffectType.class);
        KEY_TO_TYPE.put(RegistryKey.ENCHANTMENT, Enchantment.class);
        KEY_TO_TYPE.put(RegistryKey.BANNER_PATTERN, PatternType.class);
        KEY_TO_TYPE.put(RegistryKey.MENU, MenuType.class);
        KEY_TO_TYPE.put(RegistryKey.DAMAGE_TYPE, DamageType.class);
        KEY_TO_TYPE.put(RegistryKey.TRIM_MATERIAL, TrimMaterial.class);
        KEY_TO_TYPE.put(RegistryKey.TRIM_PATTERN, TrimPattern.class);
    }

    private final Map<Object, FakeRegistry<?>> registries = new ConcurrentHashMap<>();

    @Override
    public <T extends Keyed> Registry<T> getRegistry(Class<T> classOfT) {
        return getOrCreate(classOfT, classOfT, classOfT);
    }

    /**
     * Note this deliberately never throws for an unmapped {@code registryKey}:
     * {@link Registry}'s own static initializer eagerly resolves every
     * registry it knows about via this method, so failing here would break
     * every single test regardless of whether it cares about that registry.
     * The failure (if any) is deferred to {@link FakeRegistry#get} instead,
     * which only happens for registries actually queried by a test.
     */
    @Override
    public <T extends Keyed> Registry<T> getRegistry(RegistryKey<T> registryKey) {
        Class<? extends Keyed> type = KEY_TO_TYPE.get(registryKey);
        return getOrCreate(registryKey, type, registryKey);
    }

    /**
     * Deliberately implemented with plain {@link Map#get}/{@link Map#putIfAbsent}
     * rather than {@link ConcurrentHashMap#computeIfAbsent}. {@code Registry}
     * implements default methods declared by no interface of its own, but
     * {@link FakeRegistry} implements {@link Registry}, which itself declares
     * default methods; per JLS 12.4.2 that means the *first* time a
     * {@code FakeRegistry} is ever constructed, the JVM must first run
     * {@link Registry}'s own static initializer - which eagerly resolves
     * every vanilla registry by calling straight back into this method for
     * every {@link RegistryKey} it knows about. If that first construction
     * happened inside a {@code computeIfAbsent} call, this reentrant call
     * (for the same key, on the same map) would trip {@code ConcurrentHashMap}'s
     * built-in reentrancy guard and throw {@code IllegalStateException:
     * Recursive update}. Plain {@code get}/{@code putIfAbsent} have no such
     * guard, so the reentrant call simply creates (and safely discards, via
     * {@code putIfAbsent} losing the race to the outer call once it returns)
     * a redundant instance instead of throwing.
     */
    @SuppressWarnings("unchecked")
    private <T extends Keyed> Registry<T> getOrCreate(Object cacheKey, Class<? extends Keyed> type, Object descriptor) {
        FakeRegistry<?> existing = registries.get(cacheKey);
        if (existing != null) {
            return (Registry<T>) existing;
        }
        FakeRegistry<T> created = new FakeRegistry<>((Class<T>) type, descriptor);
        FakeRegistry<?> raced = registries.putIfAbsent(cacheKey, created);
        return (Registry<T>) (raced != null ? raced : created);
    }
}

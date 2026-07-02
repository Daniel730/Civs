package org.redcastlemedia.multitallented.civs.registry;

import java.util.Collection;
import java.util.Collections;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.inventory.ItemType;

import io.papermc.paper.registry.TypedKey;
import io.papermc.paper.registry.tag.Tag;
import io.papermc.paper.registry.tag.TagKey;

/**
 * Minimal in-memory {@link Registry} used by {@link FakeRegistryAccess} to
 * back Paper's registry-based pseudo-enums in unit tests. Values are created
 * lazily on first lookup via {@link FakeKeyedProxy} and cached so repeated
 * lookups of the same key return the same instance.
 *
 * <p>{@code type} may be {@code null} for registries {@link FakeRegistryAccess}
 * has no explicit type mapping for. Merely constructing such a registry is
 * harmless (needed because {@link Registry}'s own static initializer eagerly
 * resolves every registry it knows about); only calling {@link #get} on one
 * fails, with a message pointing at how to add support for it.</p>
 */
class FakeRegistry<T extends Keyed> implements Registry<T> {
    private final Class<T> type;
    private final Object descriptor;
    private final Map<NamespacedKey, T> cache = new ConcurrentHashMap<>();

    FakeRegistry(Class<T> type, Object descriptor) {
        this.type = type;
        this.descriptor = descriptor;
    }

    @Override
    public T get(NamespacedKey namespacedKey) {
        if (namespacedKey == null) {
            return null;
        }
        if (type == null) {
            throw new IllegalStateException("Registry for " + descriptor + " has no fake value type "
                    + "mapping in FakeRegistryAccess.KEY_TO_TYPE, so " + namespacedKey
                    + " cannot be resolved in tests. Add a mapping for it.");
        }
        return cache.computeIfAbsent(namespacedKey, this::createValue);
    }

    @SuppressWarnings("unchecked")
    private T createValue(NamespacedKey key) {
        // ItemType needs createItemStack() to actually work (see FakeItemTypeProxy's
        // javadoc), unlike every other registry-backed pseudo-enum this project's
        // manual mocks touch, which only ever need identity/equality.
        if (type == ItemType.class) {
            return (T) FakeItemTypeProxy.create(key);
        }
        return FakeKeyedProxy.create(type, key);
    }

    @Override
    public NamespacedKey getKey(T t) {
        return t == null ? null : t.getKey();
    }

    @Override
    public boolean hasTag(TagKey<T> tagKey) {
        return false;
    }

    @Override
    public Tag<T> getTag(TagKey<T> tagKey) {
        return new EmptyTag<>(tagKey);
    }

    @Override
    public Collection<Tag<T>> getTags() {
        return Collections.emptyList();
    }

    @Override
    public Stream<T> stream() {
        return cache.values().stream();
    }

    @Override
    public Stream<NamespacedKey> keyStream() {
        return cache.keySet().stream();
    }

    @Override
    public int size() {
        return cache.size();
    }

    @Override
    public Iterator<T> iterator() {
        return cache.values().iterator();
    }

    private static final class EmptyTag<T extends Keyed> implements Tag<T> {
        private final TagKey<T> tagKey;

        private EmptyTag(TagKey<T> tagKey) {
            this.tagKey = tagKey;
        }

        @Override
        public TagKey<T> tagKey() {
            return tagKey;
        }

        @Override
        public io.papermc.paper.registry.RegistryKey<T> registryKey() {
            return tagKey.registryKey();
        }

        @Override
        public int size() {
            return 0;
        }

        @Override
        public Collection<TypedKey<T>> values() {
            return Collections.emptyList();
        }

        @Override
        public Collection<T> resolve(Registry<T> registry) {
            return Collections.emptyList();
        }

        @Override
        public boolean contains(TypedKey<T> typedKey) {
            return false;
        }

        @Override
        public Iterator<TypedKey<T>> iterator() {
            return Collections.emptyIterator();
        }
    }
}

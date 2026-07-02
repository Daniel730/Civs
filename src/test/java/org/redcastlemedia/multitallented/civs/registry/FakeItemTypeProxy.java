package org.redcastlemedia.multitallented.civs.registry;

import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.inventory.ItemType;

/**
 * Builds fake {@link ItemType} constants.
 *
 * <p>Unlike most other registry-backed pseudo-enums this project's manual mocks
 * touch, {@code ItemType} cannot use the usual {@link FakeKeyedProxy} Mockito
 * approach (see {@link FakeItemType}'s javadoc for why) and is not just
 * compared/assigned: {@link org.bukkit.inventory.ItemStack#of} (which the legacy
 * {@code new ItemStack(material, amount, ...)} constructors still used
 * throughout this project's production code funnel into) actively calls
 * {@code createItemStack} to build the item's underlying server-backed
 * delegate. Without a working implementation, every legacy {@code ItemStack}
 * construction for a production code path (i.e. one not already going
 * through {@link org.redcastlemedia.multitallented.civs.ItemStackImpl}
 * directly) would NPE.</p>
 */
final class FakeItemTypeProxy {
    private FakeItemTypeProxy() {
    }

    static ItemType create(NamespacedKey key) {
        Material material = resolveMaterial(key);
        if (material == null) {
            throw new IllegalStateException("Unable to resolve a Material for item type key " + key
                    + " in FakeItemTypeProxy. Add explicit support for it.");
        }
        return new FakeItemType(key, material);
    }

    private static Material resolveMaterial(NamespacedKey key) {
        Material material = Material.matchMaterial(key.getKey());
        if (material == null) {
            material = Material.matchMaterial("legacy_" + key.getKey());
        }
        return material;
    }
}

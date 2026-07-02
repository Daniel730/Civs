package org.redcastlemedia.multitallented.civs.registry;

import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;
import java.util.Set;

import com.google.common.collect.ImmutableMultimap;
import com.google.common.collect.Multimap;

import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.block.BlockType;
import org.bukkit.inventory.CreativeCategory;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemRarity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.ItemType;
import org.bukkit.inventory.meta.ItemMeta;
import org.redcastlemedia.multitallented.civs.ItemStackImpl;

import io.papermc.paper.datacomponent.DataComponentType;
import net.kyori.adventure.key.Key;

/**
 * Hand-written (non-Mockito) implementation of {@link ItemType}, used instead
 * of {@link FakeKeyedProxy}'s usual Mockito-based approach.
 *
 * <p>Unlike every other registry-backed pseudo-enum this project fakes,
 * {@code ItemType}'s own static initializer resolves ~1000 constants through
 * a private helper that calls {@code Class.forName} on its {@code Typed}
 * nested type while Mockito's inline mock maker is retransforming that very
 * class - the two conflict and Mockito throws {@code ClassCastException:
 * ItemType$MockitoMock$... cannot be cast to ItemType$Typed}. Avoiding
 * Mockito for this one type entirely sidesteps the problem.</p>
 *
 * <p>Only the members this project's production code actually exercises
 * (identity via {@link #getKey()}, and {@link #createItemStack(int)} which
 * legacy {@code new ItemStack(material, amount, ...)} constructors funnel
 * into) are backed by real logic; everything else either delegates to the
 * equivalent {@link Material} fact (when cheap/unambiguous) or returns a
 * conservative "no data" default.</p>
 */
final class FakeItemType implements ItemType {
    /**
     * Standard vanilla max-durability values (unchanged for many major
     * versions) for the damageable tools/armor/combat items this project's
     * production code (see {@code RepairEffect}) actually divides by.
     * Without real values here, {@code RepairEffect.getRepairCost} would
     * divide by the previous hardcoded {@code 0} fallback and blow up to
     * {@code Integer.MAX_VALUE}.
     */
    private static final Map<Material, Short> MAX_DURABILITY = new EnumMap<>(Material.class);

    static {
        putDurability(59, Material.WOODEN_SHOVEL, Material.WOODEN_HOE, Material.WOODEN_SWORD,
                Material.WOODEN_PICKAXE, Material.WOODEN_AXE);
        putDurability(32, Material.GOLDEN_SHOVEL, Material.GOLDEN_HOE, Material.GOLDEN_SWORD,
                Material.GOLDEN_PICKAXE, Material.GOLDEN_AXE);
        putDurability(131, Material.STONE_SHOVEL, Material.STONE_HOE, Material.STONE_SWORD,
                Material.STONE_PICKAXE, Material.STONE_AXE);
        putDurability(250, Material.IRON_SHOVEL, Material.IRON_HOE, Material.IRON_SWORD,
                Material.IRON_PICKAXE, Material.IRON_AXE);
        putDurability(1561, Material.DIAMOND_SHOVEL, Material.DIAMOND_HOE, Material.DIAMOND_SWORD,
                Material.DIAMOND_PICKAXE, Material.DIAMOND_AXE);
        putDurability(2031, Material.NETHERITE_SHOVEL, Material.NETHERITE_HOE, Material.NETHERITE_SWORD,
                Material.NETHERITE_PICKAXE, Material.NETHERITE_AXE);

        putDurability(238, Material.SHEARS);
        putDurability(64, Material.FISHING_ROD);
        putDurability(384, Material.BOW);
        putDurability(465, Material.CROSSBOW);
        putDurability(432, Material.ELYTRA);
        putDurability(275, Material.TURTLE_HELMET);

        putDurability(55, Material.LEATHER_HELMET);
        putDurability(80, Material.LEATHER_CHESTPLATE);
        putDurability(75, Material.LEATHER_LEGGINGS);
        putDurability(65, Material.LEATHER_BOOTS);

        putDurability(77, Material.GOLDEN_HELMET);
        putDurability(112, Material.GOLDEN_CHESTPLATE);
        putDurability(105, Material.GOLDEN_LEGGINGS);
        putDurability(91, Material.GOLDEN_BOOTS);

        putDurability(165, Material.IRON_HELMET);
        putDurability(240, Material.IRON_CHESTPLATE);
        putDurability(225, Material.IRON_LEGGINGS);
        putDurability(195, Material.IRON_BOOTS);

        putDurability(363, Material.DIAMOND_HELMET);
        putDurability(528, Material.DIAMOND_CHESTPLATE);
        putDurability(495, Material.DIAMOND_LEGGINGS);
        putDurability(429, Material.DIAMOND_BOOTS);

        putDurability(407, Material.NETHERITE_HELMET);
        putDurability(592, Material.NETHERITE_CHESTPLATE);
        putDurability(555, Material.NETHERITE_LEGGINGS);
        putDurability(481, Material.NETHERITE_BOOTS);
    }

    private static void putDurability(int durability, Material... materials) {
        for (Material material : materials) {
            MAX_DURABILITY.put(material, (short) durability);
        }
    }

    private final NamespacedKey key;
    private final Material material;

    FakeItemType(NamespacedKey key, Material material) {
        this.key = key;
        this.material = material;
    }

    @Override
    public NamespacedKey getKey() {
        return key;
    }

    @Override
    public Typed<ItemMeta> typed() {
        throw unsupported("typed()");
    }

    @Override
    public <M extends ItemMeta> Typed<M> typed(Class<M> itemMetaType) {
        throw unsupported("typed(Class)");
    }

    @Override
    public ItemStack createItemStack() {
        return new ItemStackImpl(material, 1);
    }

    @Override
    public ItemStack createItemStack(int amount) {
        return new ItemStackImpl(material, amount);
    }

    @Override
    public boolean hasBlockType() {
        // Deliberately not material.isBlock(): that delegates to the (unmapped)
        // block registry via Material.asBlockType(), which isn't needed by any
        // current test and would just throw. Revisit if a test needs this.
        return false;
    }

    @Override
    public BlockType getBlockType() {
        throw unsupported("getBlockType()");
    }

    @Override
    public Class<? extends ItemMeta> getItemMetaClass() {
        return ItemMeta.class;
    }

    // getMaxStackSize/getMaxDurability/isEdible deliberately do NOT delegate to the
    // equivalent Material methods: since Paper 26, Material.getMaxStackSize() (etc.)
    // itself delegates to `asItemType().getMaxStackSize()` - i.e. right back here -
    // so calling material.getMaxStackSize() would infinitely recurse.

    @Override
    public int getMaxStackSize() {
        // Vanilla stacks any damageable (durability > 0) item to 1; everything
        // else defaults to 64, matching Bukkit's own fallback for when a
        // Material has no backing ItemType at all (see Material.getMaxStackSize).
        return getMaxDurability() > 0 ? 1 : 64;
    }

    @Override
    public short getMaxDurability() {
        return MAX_DURABILITY.getOrDefault(material, (short) 0);
    }

    @Override
    public boolean isEdible() {
        return false;
    }

    @Override
    public boolean isRecord() {
        return false;
    }

    @Override
    public boolean isFuel() {
        return false;
    }

    @Override
    public int getBurnDuration() {
        return 0;
    }

    @Override
    public boolean isCompostable() {
        return false;
    }

    @Override
    public float getCompostChance() {
        return 0f;
    }

    @Override
    public ItemType getCraftingRemainingItem() {
        return null;
    }

    @Override
    public Multimap<Attribute, AttributeModifier> getDefaultAttributeModifiers() {
        return ImmutableMultimap.of();
    }

    @Override
    public Multimap<Attribute, AttributeModifier> getDefaultAttributeModifiers(EquipmentSlot equipmentSlot) {
        return ImmutableMultimap.of();
    }

    @Override
    public CreativeCategory getCreativeCategory() {
        return null;
    }

    @Override
    public boolean isEnabledByFeature(World world) {
        return true;
    }

    @Override
    public Material asMaterial() {
        return material;
    }

    @Override
    public String getTranslationKey() {
        return "item." + key.getNamespace() + "." + key.getKey();
    }

    @Override
    public String translationKey() {
        return getTranslationKey();
    }

    @Override
    public ItemRarity getItemRarity() {
        return ItemRarity.COMMON;
    }

    @Override
    public <T> T getDefaultData(DataComponentType.Valued<T> type) {
        return null;
    }

    @Override
    public boolean hasDefaultData(DataComponentType type) {
        return false;
    }

    @Override
    public Set<DataComponentType> getDefaultDataTypes() {
        return Collections.emptySet();
    }

    @Override
    public Key key() {
        return key;
    }

    @Override
    public String toString() {
        return key.toString();
    }

    private static UnsupportedOperationException unsupported(String member) {
        return new UnsupportedOperationException(
                "FakeItemType." + member + " not implemented (test-only stand-in for a running Paper server)");
    }
}

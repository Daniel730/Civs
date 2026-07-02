package org.redcastlemedia.multitallented.civs;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.OfflinePlayer;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.inventory.meta.tags.CustomItemTagContainer;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.profile.PlayerProfile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.google.common.collect.Multimap;

public class ItemMetaImpl implements ItemMeta, Damageable, SkullMeta {

    private String displayName = null;
    private List<String> lore = new ArrayList<>();
    private int customModelData = 0;
    public ItemMetaImpl() {

    }
    public ItemMetaImpl(String displayName, List<String> lore) {
        this.displayName = displayName;
        this.lore = lore;
    }

    @Override
    public boolean hasDisplayName() {
        return displayName == null;
    }

    @Override
    public String getDisplayName() {
        return displayName;
    }

    @Override
    public void setDisplayName(String s) {
        this.displayName = s;
    }

    @Override
    public boolean hasLocalizedName() {
        return false;
    }

    @Override
    public String getLocalizedName() {
        return null;
    }

    @Override
    public void setLocalizedName(String s) {

    }

    @Override
    public boolean hasLore() {
        return !lore.isEmpty();
    }

    @Override
    public List<String> getLore() {
        return lore;
    }

    @Override
    public void setLore(List<String> list) {
        this.lore = list;
    }

    @Override
    public boolean hasCustomModelData() {
        return false;
    }

    @Override
    public int getCustomModelData() {
        return this.customModelData;
    }

    @Override
    public void setCustomModelData(Integer integer) {
        this.customModelData = integer;
    }

    @Override
    public boolean hasEnchants() {
        return false;
    }

    @Override
    public boolean hasEnchant(Enchantment enchantment) {
        return false;
    }

    @Override
    public int getEnchantLevel(Enchantment enchantment) {
        return 0;
    }

    @Override
    public Map<Enchantment, Integer> getEnchants() {
        return null;
    }

    @Override
    public boolean addEnchant(Enchantment enchantment, int i, boolean b) {
        return false;
    }

    @Override
    public boolean removeEnchant(Enchantment enchantment) {
        return false;
    }

    @Override
    public boolean hasConflictingEnchant(Enchantment enchantment) {
        return false;
    }

    @Override
    public void addItemFlags(ItemFlag... itemFlags) {

    }

    @Override
    public void removeItemFlags(ItemFlag... itemFlags) {

    }

    @Override
    public Set<ItemFlag> getItemFlags() {
        return null;
    }

    @Override
    public boolean hasItemFlag(ItemFlag itemFlag) {
        return false;
    }

    @Override
    public boolean isUnbreakable() {
        return false;
    }

    @Override
    public void setUnbreakable(boolean b) {

    }

    @Override
    public boolean hasAttributeModifiers() {
        return false;
    }

    @Override
    public Multimap<Attribute, AttributeModifier> getAttributeModifiers() {
        return null;
    }

    @Override
    public Multimap<Attribute, AttributeModifier> getAttributeModifiers(EquipmentSlot equipmentSlot) {
        return null;
    }

    @Override
    public Collection<AttributeModifier> getAttributeModifiers(Attribute attribute) {
        return null;
    }

    @Override
    public boolean addAttributeModifier(Attribute attribute, AttributeModifier attributeModifier) {
        return false;
    }

    @Override
    public void setAttributeModifiers(Multimap<Attribute, AttributeModifier> multimap) {

    }

    @Override
    public boolean removeAttributeModifier(Attribute attribute) {
        return false;
    }

    @Override
    public boolean removeAttributeModifier(EquipmentSlot equipmentSlot) {
        return false;
    }

    @Override
    public boolean removeAttributeModifier(Attribute attribute, AttributeModifier attributeModifier) {
        return false;
    }

    @NotNull
    @Override
    public String getAsString() {
        return null;
    }

    @Override
    public CustomItemTagContainer getCustomTagContainer() {
        return null;
    }

    @Override
    public void setVersion(int i) {

    }


    @Override
    public boolean hasDamage() {
        return false;
    }

    @Override
    public int getDamage() {
        return 0;
    }

    @Override
    public void setDamage(int i) {

    }

    @Override
    public @Nullable String getOwner() {
        return null;
    }

    @Override
    public boolean hasOwner() {
        return false;
    }

    @Override
    public boolean setOwner(@Nullable String s) {
        return false;
    }

    @Override
    public @Nullable OfflinePlayer getOwningPlayer() {
        return null;
    }

    @Override
    public boolean setOwningPlayer(@Nullable OfflinePlayer offlinePlayer) {
        return false;
    }

    @Nullable
    @Override
    public PlayerProfile getOwnerProfile() {
        return null;
    }

    @Override
    public void setOwnerProfile(@Nullable PlayerProfile playerProfile) {

    }

    @Override
    public void setNoteBlockSound(@Nullable NamespacedKey namespacedKey) {

    }

    @Nullable
    @Override
    public NamespacedKey getNoteBlockSound() {
        return null;
    }

    @Override
    public ItemMetaImpl clone() {
        return new ItemMetaImpl(displayName, lore);
    }

    @Override
    public Map<String, Object> serialize() {
        return null;
    }

    @Override
    public PersistentDataContainer getPersistentDataContainer() {
        return null;
    }

    @Override
    public Set<com.destroystokyo.paper.Namespaced> getDestroyableKeys() {
        return null;
    }

    @Override
    public void setDestroyableKeys(Collection<com.destroystokyo.paper.Namespaced> collection) {

    }

    @Override
    public boolean hasDestroyableKeys() {
        return false;
    }

    @Override
    public Set<com.destroystokyo.paper.Namespaced> getPlaceableKeys() {
        return null;
    }

    @Override
    public void setPlaceableKeys(Collection<com.destroystokyo.paper.Namespaced> collection) {

    }

    @Override
    public boolean hasPlaceableKeys() {
        return false;
    }

    @Override
    public net.kyori.adventure.text.Component customName() {
        return null;
    }

    @Override
    public void customName(net.kyori.adventure.text.Component component) {

    }

    @Override
    public String getAsComponentString() {
        return null;
    }

    @Override
    public Set<Material> getCanDestroy() {
        return null;
    }

    @Override
    public Set<Material> getCanPlaceOn() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.CustomModelDataComponent getCustomModelDataComponent() {
        return null;
    }

    @Override
    public org.bukkit.Tag<org.bukkit.damage.DamageType> getDamageResistant() {
        return null;
    }

    @Override
    public io.papermc.paper.registry.set.RegistryKeySet<org.bukkit.damage.DamageType> getDamageResistantTypes() {
        return null;
    }

    @Override
    public net.md_5.bungee.api.chat.BaseComponent[] getDisplayNameComponent() {
        return null;
    }

    @Override
    public int getEnchantable() {
        return 0;
    }

    @Override
    public Boolean getEnchantmentGlintOverride() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.EquippableComponent getEquippable() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.FoodComponent getFood() {
        return null;
    }

    @Override
    public NamespacedKey getItemModel() {
        return null;
    }

    @Override
    public String getItemName() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.JukeboxPlayableComponent getJukeboxPlayable() {
        return null;
    }

    @Override
    public List<net.md_5.bungee.api.chat.BaseComponent[]> getLoreComponents() {
        return null;
    }

    @Override
    public int getMaxDamage() {
        return 0;
    }

    @Override
    public int getMaxStackSize() {
        return 0;
    }

    @Override
    public com.destroystokyo.paper.profile.PlayerProfile getPlayerProfile() {
        return null;
    }

    @Override
    public org.bukkit.inventory.ItemRarity getRarity() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.ToolComponent getTool() {
        return null;
    }

    @Override
    public NamespacedKey getTooltipStyle() {
        return null;
    }

    @Override
    public org.bukkit.inventory.meta.components.UseCooldownComponent getUseCooldown() {
        return null;
    }

    @Override
    public org.bukkit.inventory.ItemStack getUseRemainder() {
        return null;
    }

    @Override
    public boolean hasCustomModelDataComponent() {
        return false;
    }

    @Override
    public boolean hasCustomName() {
        return false;
    }

    @Override
    public boolean hasDamageResistant() {
        return false;
    }

    @Override
    public boolean hasDamageValue() {
        return false;
    }

    @Override
    public boolean hasEnchantable() {
        return false;
    }

    @Override
    public boolean hasEnchantmentGlintOverride() {
        return false;
    }

    @Override
    public boolean hasEquippable() {
        return false;
    }

    @Override
    public boolean hasFood() {
        return false;
    }

    @Override
    public boolean hasItemModel() {
        return false;
    }

    @Override
    public boolean hasItemName() {
        return false;
    }

    @Override
    public boolean hasJukeboxPlayable() {
        return false;
    }

    @Override
    public boolean hasMaxDamage() {
        return false;
    }

    @Override
    public boolean hasMaxStackSize() {
        return false;
    }

    @Override
    public boolean hasRarity() {
        return false;
    }

    @Override
    public boolean hasTool() {
        return false;
    }

    @Override
    public boolean hasTooltipStyle() {
        return false;
    }

    @Override
    public boolean hasUseCooldown() {
        return false;
    }

    @Override
    public boolean hasUseRemainder() {
        return false;
    }

    @Override
    public boolean isFireResistant() {
        return false;
    }

    @Override
    public boolean isGlider() {
        return false;
    }

    @Override
    public boolean isHideTooltip() {
        return false;
    }

    @Override
    public net.kyori.adventure.text.Component itemName() {
        return null;
    }

    @Override
    public void itemName(net.kyori.adventure.text.Component component) {

    }

    @Override
    public List<net.kyori.adventure.text.Component> lore() {
        return null;
    }

    @Override
    public void lore(List<? extends net.kyori.adventure.text.Component> list) {

    }

    @Override
    public void removeEnchantments() {

    }

    @Override
    public void resetDamage() {

    }

    @Override
    public void setCanDestroy(Set<Material> set) {

    }

    @Override
    public void setCanPlaceOn(Set<Material> set) {

    }

    @Override
    public void setCustomModelDataComponent(org.bukkit.inventory.meta.components.CustomModelDataComponent customModelDataComponent) {

    }

    @Override
    public void setDamageResistant(org.bukkit.Tag<org.bukkit.damage.DamageType> tag) {

    }

    @Override
    public void setDamageResistantTypes(io.papermc.paper.registry.set.RegistryKeySet<org.bukkit.damage.DamageType> registryKeySet) {

    }

    @Override
    public void setDisplayNameComponent(net.md_5.bungee.api.chat.BaseComponent[] baseComponents) {

    }

    @Override
    public void setEnchantable(Integer integer) {

    }

    @Override
    public void setEnchantmentGlintOverride(Boolean aBoolean) {

    }

    @Override
    public void setEquippable(org.bukkit.inventory.meta.components.EquippableComponent equippableComponent) {

    }

    @Override
    public void setFireResistant(boolean b) {

    }

    @Override
    public void setFood(org.bukkit.inventory.meta.components.FoodComponent foodComponent) {

    }

    @Override
    public void setGlider(boolean b) {

    }

    @Override
    public void setHideTooltip(boolean b) {

    }

    @Override
    public void setItemModel(NamespacedKey namespacedKey) {

    }

    @Override
    public void setItemName(String s) {

    }

    @Override
    public void setJukeboxPlayable(org.bukkit.inventory.meta.components.JukeboxPlayableComponent jukeboxPlayableComponent) {

    }

    @Override
    public void setLoreComponents(List<net.md_5.bungee.api.chat.BaseComponent[]> list) {

    }

    @Override
    public void setMaxDamage(Integer integer) {

    }

    @Override
    public void setMaxStackSize(Integer integer) {

    }

    @Override
    public void setPlayerProfile(com.destroystokyo.paper.profile.PlayerProfile playerProfile) {

    }

    @Override
    public void setRarity(org.bukkit.inventory.ItemRarity itemRarity) {

    }

    @Override
    public void setTool(org.bukkit.inventory.meta.components.ToolComponent toolComponent) {

    }

    @Override
    public void setTooltipStyle(NamespacedKey namespacedKey) {

    }

    @Override
    public void setUseCooldown(org.bukkit.inventory.meta.components.UseCooldownComponent useCooldownComponent) {

    }

    @Override
    public void setUseRemainder(org.bukkit.inventory.ItemStack itemStack) {

    }
}

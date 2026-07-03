package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.Material;

import lombok.Getter;

@Getter
public class CustomMobDrop {
    private final Material material;
    private final int minAmount;
    private final int maxAmount;
    private final double chance;

    public CustomMobDrop(Material material, int minAmount, int maxAmount, double chance) {
        this.material = material;
        this.minAmount = minAmount;
        this.maxAmount = maxAmount;
        this.chance = chance;
    }
}

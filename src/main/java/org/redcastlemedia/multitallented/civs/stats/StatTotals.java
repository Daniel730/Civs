package org.redcastlemedia.multitallented.civs.stats;

import lombok.Getter;

@Getter
public final class StatTotals {
    private final double addTotal;
    private final double multiplyTotal;

    public StatTotals(double addTotal, double multiplyTotal) {
        this.addTotal = addTotal;
        this.multiplyTotal = multiplyTotal;
    }

    public double apply(double base) {
        return (base + addTotal) * multiplyTotal;
    }
}

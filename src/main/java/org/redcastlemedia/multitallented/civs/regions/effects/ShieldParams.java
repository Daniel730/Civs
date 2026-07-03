package org.redcastlemedia.multitallented.civs.regions.effects;

/**
 * Parsed {@code power_shield} effect vars: reduction percent (0–100).
 */
public final class ShieldParams {

    private final int reductionPercent;

    public ShieldParams(int reductionPercent) {
        this.reductionPercent = reductionPercent;
    }

    public int getReductionPercent() {
        return reductionPercent;
    }

    public static int parseReductionPercent(String vars) {
        if (vars == null || vars.isEmpty()) {
            return -1;
        }
        try {
            return clampPercent(Integer.parseInt(vars.trim()));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public static int clampPercent(int percent) {
        return Math.max(0, Math.min(100, percent));
    }
}

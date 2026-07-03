package org.redcastlemedia.multitallented.civs.regions.effects;

/**
 * Parsed {@code arrow_turret} effect vars: {@code damagePercent.speedTenths.spread}.
 */
public final class TurretParams {

    private final int damagePercent;
    private final double speed;
    private final int spread;

    public TurretParams(int damagePercent, double speed, int spread) {
        this.damagePercent = damagePercent;
        this.speed = speed;
        this.spread = spread;
    }

    public int getDamagePercent() {
        return damagePercent;
    }

    public double getSpeed() {
        return speed;
    }

    public int getSpread() {
        return spread;
    }

    public static TurretParams parse(String vars) {
        if (vars == null || vars.isEmpty()) {
            return null;
        }
        int damage = 1;
        double speed = 0.5;
        int spread = 12;
        String[] parts = vars.split("\\.");
        try {
            damage = Integer.parseInt(parts[0]);
        } catch (NumberFormatException e) {
            return null;
        }
        if (parts.length > 1) {
            try {
                speed = Double.parseDouble(parts[1]) / 10;
            } catch (NumberFormatException e) {
                return null;
            }
        }
        if (parts.length > 2) {
            try {
                spread = Integer.parseInt(parts[2]);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return new TurretParams(damage, speed, spread);
    }

    public static int parseDamagePercent(String vars) {
        if (vars == null || vars.isEmpty()) {
            return -1;
        }
        try {
            return Integer.parseInt(vars.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }
}

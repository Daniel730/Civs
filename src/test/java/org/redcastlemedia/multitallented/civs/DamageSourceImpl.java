package org.redcastlemedia.multitallented.civs;

import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Entity;

/**
 * Manual test stand-in for {@link DamageSource}. Since Paper 26, the legacy
 * {@code EntityDamageEvent(entity, cause, damage)} constructor internally
 * calls {@code DamageSource.builder(DamageType.GENERIC).build()}, which in
 * turn delegates to {@code Bukkit.getUnsafe().createDamageSourceBuilder(...)}.
 * This class (with {@link Builder}) is a minimal working implementation
 * stubbed in as that unsafe value in {@link TestUtil#serverSetup()}.
 */
public class DamageSourceImpl implements DamageSource {
    private final DamageType damageType;
    private Entity causingEntity;
    private Entity directEntity;
    private Location damageLocation;

    public DamageSourceImpl(DamageType damageType) {
        this.damageType = damageType;
    }

    @Override
    public DamageType getDamageType() {
        return damageType;
    }

    @Override
    public Entity getCausingEntity() {
        return causingEntity;
    }

    @Override
    public Entity getDirectEntity() {
        return directEntity;
    }

    @Override
    public Location getDamageLocation() {
        return damageLocation;
    }

    @Override
    public Location getSourceLocation() {
        if (damageLocation != null) {
            return damageLocation;
        }
        return causingEntity != null ? causingEntity.getLocation() : null;
    }

    @Override
    public boolean isIndirect() {
        return causingEntity != directEntity;
    }

    @Override
    public float getFoodExhaustion() {
        return 0f;
    }

    @Override
    public boolean scalesWithDifficulty() {
        return false;
    }

    public static class Builder implements DamageSource.Builder {
        private final DamageSourceImpl instance;

        public Builder(DamageType damageType) {
            this.instance = new DamageSourceImpl(damageType);
        }

        @Override
        public DamageSource.Builder withCausingEntity(Entity entity) {
            instance.causingEntity = entity;
            return this;
        }

        @Override
        public DamageSource.Builder withDirectEntity(Entity entity) {
            instance.directEntity = entity;
            return this;
        }

        @Override
        public DamageSource.Builder withDamageLocation(Location location) {
            instance.damageLocation = location;
            return this;
        }

        @Override
        public DamageSource build() {
            return instance;
        }
    }
}

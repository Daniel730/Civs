package org.redcastlemedia.multitallented.civs.npc;

import org.bukkit.Location;
import org.bukkit.entity.Villager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class GuideNpcDefinition {

    private final String id;
    private final String displayName;
    private final String world;
    private final double x;
    private final double y;
    private final double z;
    private final float yaw;
    private final Villager.Profession profession;
    private final String archetype;
    private final List<String> dialog;

    public GuideNpcDefinition(String id, String displayName, String world,
                              double x, double y, double z, float yaw,
                              Villager.Profession profession, String archetype,
                              List<String> dialog) {
        this.id = id;
        this.displayName = displayName == null || displayName.isBlank() ? id : displayName;
        this.world = world;
        this.x = x;
        this.y = y;
        this.z = z;
        this.yaw = yaw;
        this.profession = profession == null ? Villager.Profession.NONE : profession;
        this.archetype = archetype == null ? "neutral" : archetype;
        this.dialog = dialog == null ? List.of() : List.copyOf(dialog);
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getArchetype() {
        return archetype;
    }

    public List<String> getDialog() {
        return dialog;
    }

    public Location toLocation() {
        if (world == null) {
            return null;
        }
        org.bukkit.World bukkitWorld = org.bukkit.Bukkit.getWorld(world);
        if (bukkitWorld == null) {
            return null;
        }
        Location location = new Location(bukkitWorld, x, y, z);
        location.setYaw(yaw);
        return location;
    }

    public Villager.Profession getProfession() {
        return profession;
    }
}

package org.redcastlemedia.multitallented.civs.events;

import org.bukkit.event.Cancellable;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.redcastlemedia.multitallented.civs.spells.Spell;

import java.util.UUID;

/**
 * Fired after a Civs spell passes condition and target checks, immediately before
 * component costs (including mana) are evaluated or consumed.
 */
public class SpellPreCastEvent extends Event implements Cancellable {
    private static final HandlerList hList = new HandlerList();
    private final UUID uuid;
    private final Spell spell;
    private final int manaCost;
    private boolean cancelled = false;

    public SpellPreCastEvent(UUID uuid, Spell spell, int manaCost) {
        this.uuid = uuid;
        this.spell = spell;
        this.manaCost = manaCost;
    }

    public UUID getUuid() {
        return uuid;
    }

    public Spell getSpell() {
        return spell;
    }

    public String getSpellId() {
        return spell != null ? spell.getType() : null;
    }

    public int getManaCost() {
        return manaCost;
    }

    @Override
    public void setCancelled(boolean bln) {
        this.cancelled = bln;
    }

    @Override
    public boolean isCancelled() {
        return cancelled;
    }

    public static HandlerList getHandlerList() {
        return hList;
    }

    @Override
    public HandlerList getHandlers() {
        return hList;
    }
}

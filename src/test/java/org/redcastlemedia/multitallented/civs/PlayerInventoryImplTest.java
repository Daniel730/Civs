package org.redcastlemedia.multitallented.civs;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;

public class PlayerInventoryImplTest extends TestUtil {

    private PlayerInventoryImpl inventory;

    @Before
    public void setup() {
        inventory = (PlayerInventoryImpl) player.getInventory();
        inventory.clear();
    }

    @Test
    public void containsMaterialShouldDetectStoredStacks() {
        inventory.setItem(0, new ItemStackImpl(Material.GUNPOWDER, 32));

        assertTrue(inventory.contains(Material.GUNPOWDER));
        assertFalse(inventory.contains(Material.DIRT));
    }

    @Test
    public void containsAtLeastShouldSumSimilarStacks() {
        inventory.setItem(0, new ItemStackImpl(Material.GUNPOWDER, 32));
        inventory.setItem(1, new ItemStackImpl(Material.GUNPOWDER, 32));

        assertTrue(inventory.containsAtLeast(new ItemStackImpl(Material.GUNPOWDER, 1), 64));
        assertFalse(inventory.containsAtLeast(new ItemStackImpl(Material.GUNPOWDER, 1), 65));
    }
}

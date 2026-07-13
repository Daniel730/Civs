package org.redcastlemedia.multitallented.civs;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Before;
import org.junit.Test;

public class InventoryImplTest extends TestUtil {

    private InventoryImpl inventory;

    @Before
    public void setup() {
        inventory = new InventoryImpl();
    }

    @Test
    public void containsMaterialShouldDetectStoredStacks() {
        inventory.setItem(0, new ItemStackImpl(Material.IRON_PICKAXE, 1));

        assertTrue(inventory.contains(Material.IRON_PICKAXE));
        assertFalse(inventory.contains(Material.DIRT));
    }

    @Test
    public void containsAtLeastShouldSumSimilarStacks() {
        inventory.setItem(0, new ItemStackImpl(Material.COBBLESTONE, 32));
        inventory.setItem(1, new ItemStackImpl(Material.COBBLESTONE, 32));

        assertTrue(inventory.containsAtLeast(new ItemStackImpl(Material.COBBLESTONE, 1), 64));
        assertFalse(inventory.containsAtLeast(new ItemStackImpl(Material.COBBLESTONE, 1), 65));
    }
}

package org.redcastlemedia.multitallented.civs.menus;

import static org.junit.Assert.assertEquals;

import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.CVItem;

public class MenuUtilTests extends TestUtil {

    @Test
    public void waterBlockRequirementsRenderAsWaterBucket() {
        ItemStack stack = CVItem.createCVItemFromString("WATER*1").createItemStack();
        assertEquals(Material.WATER_BUCKET, stack.getType());
    }

    @Test
    public void redstoneWireRequirementsRenderAsRedstone() {
        ItemStack stack = CVItem.createCVItemFromString("REDSTONE_WIRE*1").createItemStack();
        assertEquals(Material.REDSTONE, stack.getType());
    }
}

package org.redcastlemedia.multitallented.civs.civilians;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import java.util.ArrayList;
import java.util.UUID;

import org.bukkit.Material;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;

public class CivilianTests extends TestUtil {

    @Test
    public void inventoryClickOnUnownedCivItemShouldBeCancelled() {
        RegionsTests.loadRegionTypeCobble();

        ItemStack civItem = TestUtil.createUniqueItemStack(Material.CHEST, "Civs Cobble");
        ArrayList<String> lore = new ArrayList<>();
        lore.add(new UUID(9, 9).toString());
        lore.add("cobble");
        civItem.getItemMeta().setLore(lore);

        Inventory source = mock(Inventory.class);
        when(source.getViewers()).thenReturn(new ArrayList<>());
        Inventory destination = mock(Inventory.class);
        InventoryMoveItemEvent event = mock(InventoryMoveItemEvent.class);
        when(event.getItem()).thenReturn(civItem);
        when(event.getSource()).thenReturn(source);
        when(event.getDestination()).thenReturn(destination);

        new CivilianListener().onInventoryMoveEvent(event);

        verify(event).setCancelled(true);
    }

    @Test
    public void civilianShouldNotBeOverMaxItems() {
        ItemManager itemManager = ItemManager.getInstance();
        RegionsTests.loadRegionTypeCobble();
        CivilianManager civilianManager = CivilianManager.getInstance();
        civilianManager.loadCivilian(TestUtil.player);
        Civilian civilian = civilianManager.getCivilian(TestUtil.player.getUniqueId());
        assertNull(civilian.isAtMax(itemManager.getItemType("cobble")));
    }

    @Test
    public void highestBountyShouldWork() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        ArrayList<Bounty> bountyArrayList = new ArrayList<>();
        UUID uuid = new UUID(2,6);
        bountyArrayList.add(new Bounty(new UUID(2,4),10));
        bountyArrayList.add(new Bounty(uuid,20));
        civilian.setBounties(bountyArrayList);
        Bounty bounty = civilian.getHighestBounty();
        assertEquals(20.0, bounty.getAmount(), 0.1);
    }

    @Test
    public void maxItemTest() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        civilian.getStashItems().put("mansion", 1);
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType("mansion");
        assertNull(civilian.isAtMax(regionType, true));
    }

    @Test
    public void droppingAnItemShouldPutItInBlueprints() {
        RegionsTests.loadRegionTypeCobble();
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        civilian.getStashItems().clear();
        ItemStack itemStack = TestUtil.createUniqueItemStack(Material.COBBLESTONE, "cobble");
        Item item = mock(Item.class);
        when(item.getItemStack()).thenReturn(itemStack);
        PlayerDropItemEvent playerDropItemEvent = new PlayerDropItemEvent(TestUtil.player, item);
        CivilianListener.getInstance().onCivilianDropItem(playerDropItemEvent);
        assertTrue(civilian.getStashItems().containsKey("cobble"));
    }

    @Test
    public void civilianShouldBeAtMaxWithoutRebuild() {
        RegionsTests.createNewRegion("shack", TestUtil.player.getUniqueId());
        RegionsTests.createNewRegion("shack", TestUtil.player.getUniqueId());
        RegionsTests.createNewRegion("shack", TestUtil.player.getUniqueId());
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        CivItem hovel = ItemManager.getInstance().getItemType("hovel");
        assertNull(civilian.isAtMax(hovel, true));
        assertEquals("housing", civilian.isAtMax(hovel));
    }

    public static void loadCivilian(Player player) {
        CivilianManager.getInstance().loadCivilian(player);
    }
}

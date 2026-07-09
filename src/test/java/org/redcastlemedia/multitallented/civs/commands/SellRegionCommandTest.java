package org.redcastlemedia.multitallented.civs.commands;

import static org.junit.Assert.assertEquals;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.RegionsTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class SellRegionCommandTest extends TestUtil {

    private final List<Region> createdRegions = new ArrayList<>();

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        createdRegions.clear();
    }

    @After
    public void cleanup() {
        for (Region region : createdRegions) {
            if (RegionManager.getInstance().getRegionById(region.getId()) != null) {
                RegionManager.getInstance().removeRegion(region, false, false);
            }
        }
        createdRegions.clear();
        when(player.getLocation()).thenReturn(new Location(world, 0.5, 0.5, 0.5));
    }

    @Test
    public void ownerShouldSetRegionForSale() {
        Region region = createOwnedRegion();
        SellRegionCommand command = new SellRegionCommand();
        command.runCommand(player, null, "cv", new String[] { "sell", "250" });
        assertEquals(250.0, region.getForSale(), 0.001);
    }

    @Test
    public void ownerShouldCancelRegionSaleWithoutPriceArg() {
        Region region = createOwnedRegion();
        region.setForSale(500);
        SellRegionCommand command = new SellRegionCommand();
        command.runCommand(player, null, "cv", new String[] { "sell" });
        assertEquals(-1.0, region.getForSale(), 0.001);
    }

    @Test
    public void invalidPriceShouldNotChangeSaleState() {
        Region region = createOwnedRegion();
        region.setForSale(100);
        SellRegionCommand command = new SellRegionCommand();
        command.runCommand(player, null, "cv", new String[] { "sell", "not-a-price" });
        assertEquals(100.0, region.getForSale(), 0.001);
    }

    @Test
    public void negativePriceShouldNotChangeSaleState() {
        Region region = createOwnedRegion();
        SellRegionCommand command = new SellRegionCommand();
        command.runCommand(player, null, "cv", new String[] { "sell", "-10" });
        assertEquals(-1.0, region.getForSale(), 0.001);
    }

    @Test
    public void nonOwnerShouldNotSetRegionForSale() {
        Region region = createOwnedRegion();
        UUID otherUuid = UUID.randomUUID();
        region.getRawPeople().clear();
        region.getRawPeople().put(otherUuid, Constants.OWNER);
        SellRegionCommand command = new SellRegionCommand();
        command.runCommand(player, null, "cv", new String[] { "sell", "250" });
        assertEquals(-1.0, region.getForSale(), 0.001);
    }

    private Region createOwnedRegion() {
        loadRegionTypeShelter();
        Location location = player.getLocation();
        Region existing = RegionManager.getInstance().getRegionAt(location);
        if (existing != null) {
            RegionManager.getInstance().removeRegion(existing, false, false);
        }
        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(player.getUniqueId(), Constants.OWNER);
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType("shelter");
        Region region = new Region("shelter", owners, location,
                RegionsTests.getRadii(), (HashMap) regionType.getEffects().clone(), 0);
        RegionManager.getInstance().addRegion(region);
        when(player.getLocation()).thenReturn(location);
        createdRegions.add(region);
        return region;
    }

    private static void loadRegionTypeShelter() {
        FileConfiguration config = new YamlConfiguration();
        config.set("build-reqs", new ArrayList<>());
        config.set("effects", List.of("block_break", "block_build", "buyable"));
        config.set("build-radius", 5);
        ItemManager.getInstance().loadRegionType(config, "shelter");
    }
}

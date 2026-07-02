package org.redcastlemedia.multitallented.civs.commands;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.when;

import java.io.File;
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

public class RenamePlotCommandTest extends TestUtil {

    private final List<Region> createdRegions = new ArrayList<>();

    @Before
    public void setup() {
        RegionManager.getInstance().reload();
        createdRegions.clear();
    }

    @After
    public void cleanup() {
        for (Region region : createdRegions) {
            File regionFile = new File(new File(Civs.dataLocation, Constants.REGIONS),
                    region.getId() + ".yml");
            if (regionFile.exists()) {
                regionFile.delete();
            }
            if (RegionManager.getInstance().getRegionById(region.getId()) != null) {
                RegionManager.getInstance().removeRegion(region, false, false);
            }
        }
        createdRegions.clear();
        when(player.getLocation()).thenReturn(new Location(world, 0.5, 0.5, 0.5));
    }

    @Test
    public void ownerShouldRenamePlot() {
        Region region = createOwnedPlotRegion();
        RenamePlotCommand command = new RenamePlotCommand();
        String[] args = { "rename-plot", "MyGarden" };
        command.runCommand(player, null, "cv", args);
        assertEquals("MyGarden", region.getDisplayName());
        assertEquals("MyGarden", region.getDisplayName(player));
    }

    @Test
    public void nonOwnerShouldNotRenamePlot() {
        Region region = createOwnedPlotRegion();
        UUID otherUuid = UUID.randomUUID();
        region.getRawPeople().clear();
        region.getRawPeople().put(otherUuid, Constants.OWNER);
        RenamePlotCommand command = new RenamePlotCommand();
        String[] args = { "rename-plot", "MyGarden" };
        command.runCommand(player, null, "cv", args);
        assertEquals(null, region.getDisplayName());
    }

    @Test
    public void duplicatePlotNameShouldBeRejected() {
        Region firstPlot = createOwnedPlotRegion(new Location(world, 0.5, 0.5, 0.5));
        firstPlot.setDisplayName("TakenName");
        Region secondPlot = createOwnedPlotRegion(new Location(world, 20.5, 0.5, 0.5));
        RenamePlotCommand command = new RenamePlotCommand();
        when(player.getLocation()).thenReturn(secondPlot.getLocation());
        String[] args = { "rename-plot", "TakenName" };
        command.runCommand(player, null, "cv", args);
        assertEquals(null, secondPlot.getDisplayName());
    }

    @Test
    public void invalidPlotNameShouldBeRejected() {
        Region region = createOwnedPlotRegion();
        RenamePlotCommand command = new RenamePlotCommand();
        String[] args = { "rename-plot", "bad/name" };
        command.runCommand(player, null, "cv", args);
        assertEquals(null, region.getDisplayName());
    }

    @Test
    public void isDisplayNameTakenShouldIgnoreSameRegion() {
        Region region = createOwnedPlotRegion();
        region.setDisplayName("SavedPlot");
        assertFalse(RegionManager.getInstance().isDisplayNameTaken(
                player.getUniqueId(), "SavedPlot", region));
    }

    @Test
    public void isDisplayNameTakenShouldDetectOtherOwnedPlots() {
        Region firstPlot = createOwnedPlotRegion(new Location(world, 0.5, 0.5, 0.5));
        firstPlot.setDisplayName("TakenName");
        Region secondPlot = createOwnedPlotRegion(new Location(world, 20.5, 0.5, 0.5));
        assertTrue(RegionManager.getInstance().isDisplayNameTaken(
                player.getUniqueId(), "TakenName", secondPlot));
    }

    @Test
    public void nonPlotRegionShouldNotRename() {
        RegionsTests.loadRegionTypeShelter();
        Region existing = RegionManager.getInstance().getRegionAt(player.getLocation());
        if (existing != null) {
            RegionManager.getInstance().removeRegion(existing, false, false);
        }
        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(player.getUniqueId(), Constants.OWNER);
        Region shelter = new Region("shelter", owners, player.getLocation(),
                RegionsTests.getRadii(), new HashMap<>(), 0);
        RegionManager.getInstance().addRegion(shelter);
        createdRegions.add(shelter);
        RenamePlotCommand command = new RenamePlotCommand();
        String[] args = { "rename-plot", "NotAPlot" };
        command.runCommand(player, null, "cv", args);
        assertEquals(null, shelter.getDisplayName());
    }

    private Region createOwnedPlotRegion() {
        return createOwnedPlotRegion(player.getLocation());
    }

    private Region createOwnedPlotRegion(Location location) {
        loadRegionTypePlot();
        Region existing = RegionManager.getInstance().getRegionAt(location);
        if (existing != null) {
            RegionManager.getInstance().removeRegion(existing, false, false);
        }
        HashMap<UUID, String> owners = new HashMap<>();
        owners.put(player.getUniqueId(), Constants.OWNER);
        RegionType regionType = (RegionType) ItemManager.getInstance().getItemType("plot11x11");
        Region region = new Region("plot11x11", owners, location,
                RegionsTests.getRadii(), (HashMap) regionType.getEffects().clone(), 0);
        RegionManager.getInstance().addRegion(region);
        when(player.getLocation()).thenReturn(location);
        createdRegions.add(region);
        return region;
    }

    public static void loadRegionTypePlot() {
        FileConfiguration config = new YamlConfiguration();
        config.set("build-reqs", new ArrayList<>());
        ArrayList<String> effects = new ArrayList<>();
        effects.add("block_break");
        effects.add("block_build");
        effects.add("plot");
        effects.add("buyable");
        config.set("effects", effects);
        config.set("build-radius", 5);
        ItemManager.getInstance().loadRegionType(config, "plot11x11");
    }
}

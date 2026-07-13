package org.redcastlemedia.multitallented.civs.menus.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;
import java.util.ArrayList;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.placement.BlueprintManager;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementMode;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementSession;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementSessionManager;

public class PlacementModeMenuTests extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() throws Exception {
        ensurePlacementSessionManager();
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        PlacementSessionManager.getInstance().clearSession(player.getUniqueId());
    }

    @Test
    public void placementCancelShouldClearSessionAndCloseInventory() {
        RegionType regionType = loadRegionType();
        PlacementSession session = new PlacementSession(new Location(world, 10, 64, 10), regionType, BlockFace.NORTH);
        session.setMode(PlacementMode.MANUAL);
        PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);

        PlacementModeMenu menu = new PlacementModeMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "placement-cancel", null);

        assertTrue(cancelled);
        assertNull(PlacementSessionManager.getInstance().getSession(player.getUniqueId()));
    }

    @Test
    public void modeManualShouldSetSessionMode() {
        RegionType regionType = loadRegionType();
        PlacementSession session = new PlacementSession(new Location(world, 10, 64, 10), regionType, BlockFace.NORTH);
        PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);

        PlacementModeMenu menu = new PlacementModeMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "mode-manual", null);

        assertTrue(cancelled);
        assertEquals(PlacementMode.MANUAL,
                PlacementSessionManager.getInstance().getSession(player.getUniqueId()).getMode());
    }

    @Test
    public void modeInstantShouldStayUnsetWhenBlueprintUnavailable() {
        RegionType regionType = loadInstantRegionType();
        PlacementSession session = new PlacementSession(new Location(world, 10, 64, 10), regionType, BlockFace.NORTH);
        PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);

        PlacementModeMenu menu = new PlacementModeMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "mode-instant", null);

        assertTrue(cancelled);
        assertEquals(PlacementMode.UNSET,
                PlacementSessionManager.getInstance().getSession(player.getUniqueId()).getMode());
    }

    @Test
    public void modeInstantShouldSetSessionModeWhenBlueprintAvailable() throws Exception {
        boolean previousInstant = setInstantBuildEnabled(true);
        BlueprintManager previousBlueprint = swapBlueprintManager(mockBlueprintManager());
        try {
            RegionType regionType = loadInstantRegionType();
            PlacementSession session = new PlacementSession(new Location(world, 10, 64, 10), regionType, BlockFace.NORTH);
            PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);

            PlacementModeMenu menu = new PlacementModeMenu();
            boolean cancelled = menu.doActionAndCancel(civilian, "mode-instant", null);

            assertTrue(cancelled);
            assertEquals(PlacementMode.INSTANT,
                    PlacementSessionManager.getInstance().getSession(player.getUniqueId()).getMode());
        } finally {
            setInstantBuildEnabled(previousInstant);
            swapBlueprintManager(previousBlueprint);
        }
    }

    @Test
    public void placementConfirmShouldClearSessionWhenPlacementSucceeds() throws Exception {
        RegionType regionType = loadSimpleRegionType();
        PlacementSession session = new PlacementSession(new Location(world, 60, 64, 60), regionType, BlockFace.NORTH);
        session.setMode(PlacementMode.MANUAL);
        PlacementSessionManager.getInstance().putSession(player.getUniqueId(), session);
        giveRegionToken(regionType);

        PlacementModeMenu menu = new PlacementModeMenu();
        boolean cancelled = menu.doActionAndCancel(civilian, "placement-confirm", null);

        assertTrue(cancelled);
        assertNull(PlacementSessionManager.getInstance().getSession(player.getUniqueId()));
    }

    private static RegionType loadRegionType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("CHEST*2");
        config.set("build-reqs", reqs);
        config.set("build-radius", 3);
        return ItemManager.getInstance().loadRegionType(config, "placement_mode_menu_test");
    }

    private static RegionType loadInstantRegionType() {
        YamlConfiguration config = new YamlConfiguration();
        ArrayList<String> reqs = new ArrayList<>();
        reqs.add("CHEST*2");
        config.set("build-reqs", reqs);
        config.set("build-radius", 3);
        config.set("instant-build", true);
        config.set("groups", java.util.List.of("housing"));
        return ItemManager.getInstance().loadRegionType(config, "placement_mode_instant_test");
    }

    private static RegionType loadSimpleRegionType() {
        YamlConfiguration config = new YamlConfiguration();
        config.set("build-reqs", new ArrayList<String>());
        config.set("build-radius", 1);
        return ItemManager.getInstance().loadRegionType(config, "placement_mode_confirm_test");
    }

    private static void giveRegionToken(RegionType regionType) {
        org.redcastlemedia.multitallented.civs.ItemStackImpl token =
                new org.redcastlemedia.multitallented.civs.ItemStackImpl(Material.CHEST, 1);
        org.redcastlemedia.multitallented.civs.ItemMetaImpl meta =
                (org.redcastlemedia.multitallented.civs.ItemMetaImpl) token.getItemMeta();
        meta.getLore().add("");
        meta.getLore().add(regionType.getProcessedName());
        ((org.redcastlemedia.multitallented.civs.PlayerInventoryImpl) player.getInventory()).setItem(0, token);
    }

    private static BlueprintManager mockBlueprintManager() {
        BlueprintManager blueprintManager = mock(BlueprintManager.class);
        when(blueprintManager.isWorldEditAvailable()).thenReturn(true);
        when(blueprintManager.hasBlueprint(any())).thenReturn(true);
        return blueprintManager;
    }

    private static boolean setInstantBuildEnabled(boolean enabled) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("instantBuildEnabled");
        field.setAccessible(true);
        boolean previous = field.getBoolean(ConfigManager.getInstance());
        field.setBoolean(ConfigManager.getInstance(), enabled);
        return previous;
    }

    private static BlueprintManager swapBlueprintManager(BlueprintManager replacement) throws Exception {
        Field field = BlueprintManager.class.getDeclaredField("instance");
        field.setAccessible(true);
        BlueprintManager previous = (BlueprintManager) field.get(null);
        field.set(null, replacement);
        return previous;
    }

    private static void ensurePlacementSessionManager() throws Exception {
        Field field = PlacementSessionManager.class.getDeclaredField("instance");
        field.setAccessible(true);
        if (field.get(null) == null) {
            field.set(null, new PlacementSessionManager());
        }
    }
}

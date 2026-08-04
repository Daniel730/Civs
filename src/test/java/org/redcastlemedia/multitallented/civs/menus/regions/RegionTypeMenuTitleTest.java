package org.redcastlemedia.multitallented.civs.menus.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.util.HashMap;
import java.util.List;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.effects.ForSaleEffect;
import org.redcastlemedia.multitallented.civs.util.Constants;

/**
 * Verifies that the region-type GUI shows the structure's display name (e.g.
 * "Shelter") as its title instead of the raw internal menu name ("region-type").
 */
public class RegionTypeMenuTitleTest extends TestUtil {

    private Civilian civilian;

    @Before
    public void setup() {
        MenuManager.clearData(player.getUniqueId());
        civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
    }

    private RegionType loadType(String name) {
        YamlConfiguration config = new YamlConfiguration();
        config.set("icon", "CHEST");
        config.set("name", name);
        config.set("effects", List.of(ForSaleEffect.KEY));
        ItemManager.getInstance().loadRegionType(config, name);
        return (RegionType) ItemManager.getInstance().getItemType(name);
    }

    @Test
    public void titleShowsRegionDisplayNameWhenTypeIsInData() {
        RegionType regionType = loadType("title_shelter");
        HashMap<String, Object> data = new HashMap<>();
        data.put(Constants.REGION_TYPE, regionType);
        MenuManager.setNewData(player.getUniqueId(), data);

        RegionTypeMenu menu = new RegionTypeMenu();
        String title = menu.getMenuTitle(civilian);

        assertEquals(regionType.getDisplayName(player), title);
        // The old behaviour used the raw internal menu name; make sure we moved off it.
        assertNotEquals("region-type", title);
        assertNotEquals("RegionType", title);
    }

    @Test
    public void titleFallsBackToMenuNameWhenNoTypeInData() {
        // No REGION_TYPE in data -> must not throw and must fall back to the menu name.
        MenuManager.setNewData(player.getUniqueId(), new HashMap<>());
        RegionTypeMenu menu = new RegionTypeMenu();

        String title = menu.getMenuTitle(civilian);

        assertEquals(menu.getName(), title);
    }
}

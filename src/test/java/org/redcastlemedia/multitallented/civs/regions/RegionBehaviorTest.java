package org.redcastlemedia.multitallented.civs.regions;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.effects.ForSaleEffect;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.util.Constants;

/**
 * Behavioral tests for {@link Region} that don't require placing blocks: ownership/role
 * resolution (permissions), the location identity round-trip used as the region's id, and
 * the upkeep cooldown calculation. Lives in the region package to read the package-private
 * {@code lastTick} field directly.
 */
public class RegionBehaviorTest extends TestUtil {

    private RegionType type;

    @Before
    public void setup() {
        TownManager.getInstance().reload(); // ensure no town overlaps the test location
        YamlConfiguration config = new YamlConfiguration();
        config.set("icon", "CHEST");
        config.set("name", "behavior_region");
        config.set("period", 600);
        config.set("effects", List.of(ForSaleEffect.KEY));
        ItemManager.getInstance().loadRegionType(config, "behavior_region");
        type = (RegionType) ItemManager.getInstance().getItemType("behavior_region");
    }

    private Region regionWithPeople(HashMap<UUID, String> people) {
        Location location = new Location(TestUtil.world, 300, 64, 300);
        @SuppressWarnings("unchecked")
        HashMap<String, String> effects = (HashMap<String, String>) type.getEffects().clone();
        return new Region(type.getProcessedName(), people, location, new int[] {3, 3, 3, 3, 3, 3}, effects, 0);
    }

    @Test
    public void getOwnersReturnsOnlyOwnerRoles() {
        UUID owner = UUID.randomUUID();
        UUID member = UUID.randomUUID();
        UUID guest = UUID.randomUUID();
        HashMap<UUID, String> people = new HashMap<>();
        people.put(owner, Constants.OWNER);
        people.put(member, Constants.MEMBER);
        people.put(guest, Constants.GUEST);

        Set<UUID> owners = regionWithPeople(people).getOwners();
        assertTrue(owners.contains(owner));
        assertFalse(owners.contains(member));
        assertFalse(owners.contains(guest));
        assertEquals(1, owners.size());
    }

    @Test
    public void getPeopleWithoutTownReturnsRawPeople() {
        UUID owner = UUID.randomUUID();
        HashMap<UUID, String> people = new HashMap<>();
        people.put(owner, Constants.OWNER);
        Region region = regionWithPeople(people);
        // No town overlaps 300,64,300 -> getPeople() is just the raw membership.
        assertEquals(region.getRawPeople(), region.getPeople());
    }

    @Test
    public void locationIdRoundTrips() {
        Location location = new Location(TestUtil.world, 42, 63, -17);
        String id = Region.locationToString(location);
        Location parsed = Region.idToLocation(id);
        assertEquals(location.getBlockX(), parsed.getBlockX());
        assertEquals(location.getBlockY(), parsed.getBlockY());
        assertEquals(location.getBlockZ(), parsed.getBlockZ());
        assertEquals(TestUtil.world.getUID(), parsed.getWorld().getUID());
    }

    @Test
    public void secondsTillNextTickIsZeroWhenOverdueAndPositiveWhenRecent() {
        Region region = regionWithPeople(new HashMap<>());

        region.lastTick = 0; // never ticked -> long overdue
        assertEquals(0, region.getSecondsTillNextTick());

        region.lastTick = new java.util.Date().getTime(); // just ticked
        long remaining = region.getSecondsTillNextTick();
        assertTrue("cooldown should be positive right after a tick", remaining > 0);
        assertTrue("cooldown should not exceed the period", remaining <= 600);
    }
}

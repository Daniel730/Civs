package org.redcastlemedia.multitallented.civs.util;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;

/**
 * Edge-case behavioral coverage for pure {@link Util} helpers not already exercised by
 * {@code UtilTests} (which only checks a couple of happy paths). Focus: file-name
 * validation/sanitisation, number formatting fallbacks, location equivalence tolerance,
 * and solid-block classification.
 */
public class UtilBehaviorTest extends TestUtil {

    // ---- validateFileName / getValidFileName --------------------------------------

    @Test
    public void validateFileNameRejectsIllegalNamesAndOverlongNames() {
        assertTrue(Util.validateFileName("normal_name"));
        assertFalse("names over 40 chars are rejected",
                Util.validateFileName("a".repeat(41)));
        assertFalse("path separators are illegal", Util.validateFileName("foo/bar"));
        assertFalse(Util.validateFileName("foo\\bar"));
        assertFalse("reserved filename chars are illegal", Util.validateFileName("na:me"));
        assertFalse(Util.validateFileName("na*me"));
        assertFalse(Util.validateFileName("na?me"));
        assertFalse(Util.validateFileName("na<me>"));
        assertFalse("ampersand is disallowed", Util.validateFileName("a&b"));
    }

    @Test
    public void getValidFileNameStripsLeadingIllegalCharacters() {
        // Leading path/reserved characters are stripped; a clean tail survives.
        assertEquals("name", Util.getValidFileName("/name"));
        assertEquals("name", Util.getValidFileName(":*name"));
        assertEquals("clean", Util.getValidFileName("clean"));
    }

    // ---- getNumberFormat ----------------------------------------------------------

    @Test
    public void numberFormatUsesLocaleGrouping() {
        // German groups with '.' and uses ',' as decimal separator.
        assertEquals("1.000", Util.getNumberFormat(1000, "de"));
        // A non-grouping small number is unchanged.
        assertEquals("42", Util.getNumberFormat(42, "en"));
    }

    @Test
    public void numberFormatToleratesUnknownLocale() {
        // Must not throw for a nonsense locale tag; still formats.
        String formatted = Util.getNumberFormat(5, "not-a-locale-xyz");
        assertTrue(formatted.contains("5"));
    }

    // ---- equivalentLocations ------------------------------------------------------

    @Test
    public void equivalentLocationsUsesOneBlockToleranceAndNullRules() {
        Location a = new Location(TestUtil.world, 10, 64, 10);
        Location within = new Location(TestUtil.world, 10.9, 64.0, 10.0); // <1 apart
        Location outside = new Location(TestUtil.world, 12, 64, 10);      // >=1 apart
        assertTrue(Util.equivalentLocations(a, within));
        assertFalse(Util.equivalentLocations(a, outside));

        assertTrue("two nulls are considered equivalent",
                Util.equivalentLocations(null, null));
        assertFalse(Util.equivalentLocations(a, null));

        World otherWorld = mock(World.class);
        when(otherWorld.getUID()).thenReturn(UUID.randomUUID());
        Location differentWorld = new Location(otherWorld, 10, 64, 10);
        assertFalse("same coords in a different world are not equivalent",
                Util.equivalentLocations(a, differentWorld));
    }

    // ---- isSolidBlock -------------------------------------------------------------

    @Test
    public void isSolidBlockTreatsAttachmentsAsNonSolid() {
        assertTrue(Util.isSolidBlock(Material.STONE));
        assertTrue(Util.isSolidBlock(Material.DIRT));
        assertFalse(Util.isSolidBlock(Material.AIR));
        assertFalse(Util.isSolidBlock(Material.LEVER));
        assertFalse(Util.isSolidBlock(Material.TORCH));
        assertFalse(Util.isSolidBlock(Material.OAK_BUTTON));
        assertFalse(Util.isSolidBlock(Material.OAK_WALL_SIGN));
    }
}

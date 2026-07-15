package org.redcastlemedia.multitallented.civs.regions;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class RebuildGroupLimitTests {

    @Test
    public void sameGroupRebuildIsExemptFromGroupLimit() {
        RegionType farm = mock(RegionType.class);
        when(farm.getGroups()).thenReturn(Arrays.asList("farms", "production"));
        assertTrue(RegionManager.isSameGroupRebuild(farm, "farms"));
    }

    @Test
    public void differentGroupRebuildIsNotExempt() {
        RegionType shop = mock(RegionType.class);
        when(shop.getGroups()).thenReturn(Collections.singletonList("shops"));
        assertFalse(RegionManager.isSameGroupRebuild(shop, "farms"));
    }

    @Test
    public void nullRebuildTypeIsNotExempt() {
        assertFalse(RegionManager.isSameGroupRebuild(null, "farms"));
    }
}

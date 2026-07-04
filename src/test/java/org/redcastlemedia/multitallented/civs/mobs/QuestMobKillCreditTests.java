package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.mockito.junit.MockitoJUnitRunner;

import java.util.UUID;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

@RunWith(MockitoJUnitRunner.class)
public class QuestMobKillCreditTests {

    private MockedStatic<Bukkit> bukkit;

    @Before
    public void setUp() {
        bukkit = mockStatic(Bukkit.class);
    }

    @After
    public void tearDown() {
        bukkit.close();
    }

    @Test
    public void nonQuestMobCreditsKiller() {
        Player killer = mock(Player.class);
        assertEquals(killer, QuestMobKillCredit.resolve(killer, null, 0));
    }

    @Test
    public void questOwnerKillCreditsOwner() {
        UUID ownerId = UUID.randomUUID();
        Player killer = mock(Player.class);
        when(killer.getUniqueId()).thenReturn(ownerId);

        assertEquals(killer, QuestMobKillCredit.resolve(killer, ownerId, 32));
    }

    @Test
    public void partyMemberWithinRadiusCreditsOwner() {
        UUID ownerId = UUID.randomUUID();
        UUID allyId = UUID.randomUUID();
        World world = mock(World.class);
        Player killer = mock(Player.class);
        Player owner = mock(Player.class);
        Location killerLoc = new Location(world, 0, 64, 0);
        Location ownerLoc = new Location(world, 10, 64, 0);

        when(killer.getUniqueId()).thenReturn(allyId);
        when(killer.getWorld()).thenReturn(world);
        when(killer.getLocation()).thenReturn(killerLoc);
        when(owner.isOnline()).thenReturn(true);
        when(owner.getWorld()).thenReturn(world);
        when(owner.getLocation()).thenReturn(ownerLoc);
        bukkit.when(() -> Bukkit.getPlayer(ownerId)).thenReturn(owner);

        assertEquals(owner, QuestMobKillCredit.resolve(killer, ownerId, 32));
    }

    @Test
    public void strangerOutsideRadiusGetsNoCredit() {
        UUID ownerId = UUID.randomUUID();
        UUID strangerId = UUID.randomUUID();
        World world = mock(World.class);
        Player killer = mock(Player.class);
        Player owner = mock(Player.class);
        Location killerLoc = new Location(world, 0, 64, 0);
        Location ownerLoc = new Location(world, 100, 64, 0);

        when(killer.getUniqueId()).thenReturn(strangerId);
        when(killer.getWorld()).thenReturn(world);
        when(killer.getLocation()).thenReturn(killerLoc);
        when(owner.isOnline()).thenReturn(true);
        when(owner.getWorld()).thenReturn(world);
        when(owner.getLocation()).thenReturn(ownerLoc);
        bukkit.when(() -> Bukkit.getPlayer(ownerId)).thenReturn(owner);

        assertNull(QuestMobKillCredit.resolve(killer, ownerId, 32));
    }

    @Test
    public void zeroPartyRadiusRejectsNonOwnerKiller() {
        UUID ownerId = UUID.randomUUID();
        Player killer = mock(Player.class);
        when(killer.getUniqueId()).thenReturn(UUID.randomUUID());

        assertNull(QuestMobKillCredit.resolve(killer, ownerId, 0));
    }
}

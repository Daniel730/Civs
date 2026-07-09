package org.redcastlemedia.multitallented.civs.commands;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.when;

import java.util.HashSet;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.towns.Government;
import org.redcastlemedia.multitallented.civs.towns.GovernmentManager;
import org.redcastlemedia.multitallented.civs.towns.GovernmentType;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.towns.TownTests;
import org.redcastlemedia.multitallented.civs.util.Constants;

public class ColonialCommandTests extends TestUtil {

    @Before
    public void setup() {
        TownManager.getInstance().reload();
        GovernmentManager.getInstance().reload();
        Government government = new Government("DICTATORSHIP", GovernmentType.DICTATORSHIP,
                new HashSet<>(), null, new java.util.ArrayList<>(), true);
        TownTests.addGovernmentType(government);
    }

    @Test
    public void colonialOwnerCanSetOwnerOnColonyTown() {
        TownTests.loadTownTypeHamlet2();
        Town colony = TownTests.loadTown("colony", "hamlet2", new Location(world, 10, 0, 10));
        colony.setGovernmentType("DICTATORSHIP");
        colony.getRawPeople().clear();
        colony.getRawPeople().put(player2.getUniqueId(), Constants.MEMBER);

        Town master = TownTests.loadTown("master", "hamlet2", new Location(world, 100, 0, 100));
        master.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        colony.setColonialTown("master");

        when(player2.isOnline()).thenReturn(true);
        when(player2.getDisplayName()).thenReturn("Player2");
        when(player2.getName()).thenReturn("Player2");
        when(Bukkit.getOfflinePlayer(player2.getUniqueId())).thenReturn(player2);
        when(Bukkit.getPlayer(player2.getUniqueId())).thenReturn(player2);

        SetOwnerCommand command = new SetOwnerCommand();
        String[] args = {"setowner", player2.getUniqueId().toString(), "colony"};
        command.runCommand(player, null, "cv", args);

        assertTrue(colony.getPeople().get(player2.getUniqueId()).contains(Constants.OWNER));
    }

    @Test
    public void missingColonialTownDeniesSetOwnerForNonOwner() {
        TownTests.loadTownTypeHamlet2();
        Town colony = TownTests.loadTown("colony2", "hamlet2", new Location(world, 20, 0, 20));
        colony.setGovernmentType("DICTATORSHIP");
        UUID otherOwner = new UUID(9, 9);
        colony.getRawPeople().clear();
        colony.getRawPeople().put(otherOwner, Constants.OWNER);
        colony.getRawPeople().put(player.getUniqueId(), Constants.MEMBER);
        colony.getRawPeople().put(player2.getUniqueId(), Constants.MEMBER);
        colony.setColonialTown("missing_master");

        when(player2.isOnline()).thenReturn(true);
        when(player2.getDisplayName()).thenReturn("Player2");
        when(player2.getName()).thenReturn("Player2");
        when(Bukkit.getOfflinePlayer(player2.getUniqueId())).thenReturn(player2);
        when(Bukkit.getPlayer(player2.getUniqueId())).thenReturn(player2);

        SetOwnerCommand command = new SetOwnerCommand();
        String[] args = {"setowner", player2.getUniqueId().toString(), "colony2"};
        command.runCommand(player, null, "cv", args);

        assertFalse(colony.getPeople().containsKey(player2.getUniqueId())
                && colony.getPeople().get(player2.getUniqueId()).contains(Constants.OWNER));
    }

    @Test
    public void colonialOwnerCanSetRecruiterOnColonyTown() {
        TownTests.loadTownTypeHamlet2();
        Town colony = TownTests.loadTown("colony3", "hamlet2", new Location(world, 30, 0, 30));
        colony.setGovernmentType("DICTATORSHIP");
        colony.getRawPeople().clear();
        colony.getRawPeople().put(player2.getUniqueId(), Constants.MEMBER);

        Town master = TownTests.loadTown("master3", "hamlet2", new Location(world, 130, 0, 130));
        master.getRawPeople().put(player.getUniqueId(), Constants.OWNER);
        colony.setColonialTown("master3");

        when(player2.isOnline()).thenReturn(true);
        when(player2.getDisplayName()).thenReturn("Player2");
        when(player2.getName()).thenReturn("Player2");
        when(Bukkit.getOfflinePlayer(player2.getUniqueId())).thenReturn(player2);
        when(Bukkit.getPlayer(player2.getUniqueId())).thenReturn(player2);

        SetRecruiterCommand command = new SetRecruiterCommand();
        String[] args = {"setrecruiter", player2.getUniqueId().toString(), "colony3"};
        command.runCommand(player, null, "cv", args);

        assertTrue(colony.getPeople().get(player2.getUniqueId()).contains("recruiter"));
    }

    @Test
    public void missingColonialTownDeniesSetRecruiterForNonOwner() {
        TownTests.loadTownTypeHamlet2();
        Town colony = TownTests.loadTown("colony4", "hamlet2", new Location(world, 40, 0, 40));
        colony.setGovernmentType("DICTATORSHIP");
        UUID otherOwner = new UUID(8, 8);
        colony.getRawPeople().clear();
        colony.getRawPeople().put(otherOwner, Constants.OWNER);
        colony.getRawPeople().put(player.getUniqueId(), Constants.MEMBER);
        colony.getRawPeople().put(player2.getUniqueId(), Constants.MEMBER);
        colony.setColonialTown("ghost_master");

        when(player2.isOnline()).thenReturn(true);
        when(player2.getDisplayName()).thenReturn("Player2");
        when(player2.getName()).thenReturn("Player2");
        when(Bukkit.getOfflinePlayer(player2.getUniqueId())).thenReturn(player2);
        when(Bukkit.getPlayer(player2.getUniqueId())).thenReturn(player2);

        SetRecruiterCommand command = new SetRecruiterCommand();
        String[] args = {"setrecruiter", player2.getUniqueId().toString(), "colony4"};
        command.runCommand(player, null, "cv", args);

        assertFalse(colony.getPeople().containsKey(player2.getUniqueId())
                && colony.getPeople().get(player2.getUniqueId()).contains("recruiter"));
    }
}

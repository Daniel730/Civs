package org.redcastlemedia.multitallented.civs.commands;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.util.Constants;

@CivsCommand(keys = { "recalc" }) @SuppressWarnings("unused")
public class RecalcCommand extends CivCommand {
    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        boolean isAdmin = !(commandSender instanceof Player) || commandSender.isOp() ||
                (Civs.perm != null && Civs.perm.has(commandSender, Constants.ADMIN_PERMISSION));
        if (!isAdmin) {
            return true;
        }
        TownManager townManager = TownManager.getInstance();
        if (args.length >= 2) {
            Town town = townManager.getTown(args[1]);
            if (town == null) {
                commandSender.sendMessage(Civs.getPrefix() + "Town " + args[1] + " not found");
                return true;
            }
            boolean changed = townManager.recalculateHousingAndVillagers(town);
            commandSender.sendMessage(Civs.getPrefix() + (changed ?
                    "Recalculated housing/villagers for " + town.getName() :
                    "Housing/villagers already correct for " + town.getName()));
            return true;
        }
        int changedCount = 0;
        for (Town town : townManager.getTowns()) {
            if (townManager.recalculateHousingAndVillagers(town)) {
                changedCount++;
            }
        }
        commandSender.sendMessage(Civs.getPrefix() + "Recalculated housing/villagers for " +
                changedCount + " town(s)");
        return true;
    }

    @Override
    public boolean canUseCommand(CommandSender commandSender) {
        return Civs.perm != null && Civs.perm.has(commandSender, Constants.ADMIN_PERMISSION);
    }
}

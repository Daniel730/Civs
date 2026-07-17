package org.redcastlemedia.multitallented.civs.commands;

import java.util.ArrayList;
import java.util.List;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Admin QA helper: {@code /cv give <player> <itemType> [qty]}.
 * Permission {@link Constants#ADMIN_PERMISSION}. Console allowed.
 */
@CivsCommand(keys = { "give" })
@SuppressWarnings("unused")
public class GiveCommand extends CivCommand {

    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        if (Civs.perm == null || !Civs.perm.has(commandSender, Constants.ADMIN_PERMISSION)) {
            if (!(commandSender.isOp())) {
                Util.sendMessageToPlayerOrConsole(commandSender, "no-permission",
                        "Permission denied. Need civs.admin");
                return true;
            }
        }
        if (args.length < 3) {
            Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                    "Usage: /cv give <player> <itemType> [qty]");
            return true;
        }
        Player target = Bukkit.getPlayerExact(args[1]);
        if (target == null || !target.isOnline()) {
            Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                    "Player not online: " + args[1]);
            return true;
        }
        String typeName = args[2].toLowerCase().replace("-", "_");
        CivItem civItem = ItemManager.getInstance().getItemType(typeName);
        if (civItem == null) {
            Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                    "Unknown Civs item: " + typeName);
            return true;
        }
        int qty = 1;
        if (args.length >= 4) {
            try {
                qty = Math.max(1, Math.min(64, Integer.parseInt(args[3])));
            } catch (NumberFormatException ignored) {
                qty = 1;
            }
        }
        for (int i = 0; i < qty; i++) {
            ItemStack stack = civItem.createItemStack(target);
            target.getInventory().addItem(stack);
        }
        commandSender.sendMessage(Civs.getPrefix() + "Gave " + qty + "x " + typeName + " to " + target.getName());
        return true;
    }

    @Override
    public boolean canUseCommand(CommandSender commandSender) {
        return commandSender.isOp()
                || (Civs.perm != null && Civs.perm.has(commandSender, Constants.ADMIN_PERMISSION));
    }

    @Override
    public List<String> getWord(CommandSender commandSender, String[] args) {
        if (args.length == 2) {
            List<String> suggestions = new ArrayList<>();
            addAllOnlinePlayers(suggestions, args[1]);
            return suggestions;
        }
        return super.getWord(commandSender, args);
    }
}

package org.redcastlemedia.multitallented.civs.commands;

import java.util.ArrayList;
import java.util.List;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

/**
 * Admin QA helper: place/activate a region without mouse.
 * {@code /cv placeregion <player> <regionType> [x] [y] [z]}
 * Uses block under player feet+1 when coords omitted. Permission {@code civs.admin}.
 */
@CivsCommand(keys = { "placeregion", "qa-place" })
@SuppressWarnings("unused")
public class PlaceRegionCommand extends CivCommand {

    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        if (!canUseCommand(commandSender)) {
            Util.sendMessageToPlayerOrConsole(commandSender, "no-permission",
                    "Permission denied. Need civs.admin");
            return true;
        }
        if (args.length < 3) {
            Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                    "Usage: /cv placeregion <player> <regionType> [x] [y] [z]");
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
        if (!(civItem instanceof RegionType regionType)) {
            Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                    "Not a region type: " + typeName);
            return true;
        }

        Location loc;
        if (args.length >= 6) {
            try {
                World world = target.getWorld();
                double x = Double.parseDouble(args[3]);
                double y = Double.parseDouble(args[4]);
                double z = Double.parseDouble(args[5]);
                loc = new Location(world, x, y, z);
            } catch (NumberFormatException ex) {
                Util.sendMessageToPlayerOrConsole(commandSender, "invalid-target",
                        "Invalid coordinates");
                return true;
            }
        } else {
            loc = target.getLocation().getBlock().getLocation();
        }

        // Ensure center icon chest (Civs region center)
        Material icon = regionType.getMat() != null ? regionType.getMat() : Material.CHEST;
        if (icon == Material.AIR) {
            icon = Material.CHEST;
        }
        loc.getBlock().setType(icon);

        // Ensure player holds a matching token so createRegion can consume it
        boolean hasToken = false;
        for (ItemStack stack : target.getInventory().getContents()) {
            if (stack == null) {
                continue;
            }
            CivItem held = CivItem.getFromItemStack(stack);
            if (held != null && held.getProcessedName().equals(regionType.getProcessedName())) {
                hasToken = true;
                break;
            }
        }
        if (!hasToken) {
            target.getInventory().addItem(regionType.createItemStack(target));
        }

        boolean ok = RegionManager.getInstance().adminCreateRegion(target, loc, regionType);
        if (ok) {
            commandSender.sendMessage(Civs.getPrefix() + "placeregion OK " + typeName
                    + " @ " + loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ());
        } else {
            commandSender.sendMessage(Civs.getPrefix() + "placeregion FAIL " + typeName
                    + " (check pre-reqs / build-reqs / town / overlap)");
        }
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

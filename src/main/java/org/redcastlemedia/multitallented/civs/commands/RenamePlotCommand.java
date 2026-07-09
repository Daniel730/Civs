package org.redcastlemedia.multitallented.civs.commands;

import java.util.List;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.dynmaphook.DynmapHook;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.pl3xmap.Pl3xMapHook;
import org.redcastlemedia.multitallented.civs.regions.Region;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsCommand(keys = { "rename-plot" }) @SuppressWarnings("unused")
public class RenamePlotCommand extends CivCommand {
    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        if (!(commandSender instanceof Player)) {
            return true;
        }
        Player player = (Player) commandSender;
        LocaleManager localeManager = LocaleManager.getInstance();

        if (args.length < 2) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "rename-plot-desc"));
            return true;
        }

        Region region;
        String newName;
        if (args.length >= 3) {
            region = RegionManager.getInstance().getRegionById(args[1]);
            newName = args[2];
        } else {
            region = RegionManager.getInstance().getRegionAt(player.getLocation());
            newName = args[1];
        }

        if (region == null) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "stand-in-region")
                    .replace("$1", player.getDisplayName()));
            return true;
        }

        if (!region.isPlot()) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "plot-not-renameable"));
            return true;
        }

        if (!region.getRawPeople().containsKey(player.getUniqueId()) ||
                !region.getRawPeople().get(player.getUniqueId()).contains(Constants.OWNER)) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "no-permission"));
            return true;
        }

        if (!Util.validateFileName(newName)) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "invalid-name"));
            return true;
        }

        String validName = Util.getValidFileName(newName);
        if (RegionManager.getInstance().isDisplayNameTaken(player.getUniqueId(), validName, region)) {
            player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "invalid-name"));
            return true;
        }
        region.setDisplayName(validName);
        RegionManager.getInstance().saveRegion(region);
        DynmapHook.refreshRegionMarker(region);
        Pl3xMapHook.refreshRegionMarker(region);

        player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "plot-renamed")
                .replace("$1", validName));
        return true;
    }

    @Override
    public boolean canUseCommand(CommandSender commandSender) {
        return commandSender instanceof Player;
    }

    @Override
    public List<String> getWord(CommandSender commandSender, String[] args) {
        if (args.length == 2 && commandSender instanceof Player) {
            Player player = (Player) commandSender;
            Region region = RegionManager.getInstance().getRegionAt(player.getLocation());
            if (region != null) {
                return List.of(region.getId());
            }
        }
        return super.getWord(commandSender, args);
    }
}

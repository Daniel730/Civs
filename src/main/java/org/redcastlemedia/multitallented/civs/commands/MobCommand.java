package org.redcastlemedia.multitallented.civs.commands;

import java.util.ArrayList;
import java.util.List;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.mobs.CustomMobManager;
import org.redcastlemedia.multitallented.civs.util.Constants;

@CivsCommand(keys = { "mob" })
public class MobCommand extends CivCommand {

    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        if (!ConfigManager.getInstance().isUseCustomMobs()) {
            commandSender.sendMessage(Civs.getPrefix() + "Custom mobs are disabled.");
            return true;
        }
        if (!(commandSender instanceof Player player)) {
            commandSender.sendMessage(Civs.getPrefix() + "Players only.");
            return true;
        }
        if (args.length < 2) {
            player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-usage"));
            return true;
        }
        String sub = args[1].toLowerCase();
        if ("list".equals(sub)) {
            List<String> ids = new ArrayList<>(CustomMobManager.getInstance().getMobIds());
            if (ids.isEmpty()) {
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-none"));
            } else {
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-list")
                        .replace("$1", String.join(", ", ids)));
            }
            return true;
        }
        if ("spawn".equals(sub)) {
            if (!canSpawn(player)) {
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "no-permission"));
                return true;
            }
            if (args.length < 3) {
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-usage"));
                return true;
            }
            String mobId = args[2].toLowerCase();
            LivingEntity spawned = CustomMobManager.getInstance().spawn(mobId, player.getLocation());
            if (spawned == null) {
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-not-found")
                        .replace("$1", mobId));
                return true;
            }
            String display = CustomMobManager.getInstance().getMob(mobId).getDisplay();
            player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-spawned")
                    .replace("$1", LocaleManager.getInstance().getTranslation(player, display)));
            return true;
        }
        player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "custom-mob-usage"));
        return true;
    }

    private boolean canSpawn(Player player) {
        return player.isOp() || (Civs.perm != null && Civs.perm.has(player, Constants.ADMIN_PERMISSION));
    }

    @Override
    public boolean canUseCommand(CommandSender commandSender) {
        return commandSender instanceof Player;
    }

    @Override
    public List<String> getWord(CommandSender commandSender, String[] args) {
        if (args.length == 2) {
            List<String> suggestions = new ArrayList<>();
            String prefix = args[1].toLowerCase();
            for (String sub : List.of("spawn", "list")) {
                if (sub.startsWith(prefix)) {
                    suggestions.add(sub);
                }
            }
            return suggestions;
        }
        if (args.length == 3 && "spawn".equalsIgnoreCase(args[1])) {
            List<String> suggestions = new ArrayList<>();
            String prefix = args[2].toLowerCase();
            for (String mobId : CustomMobManager.getInstance().getMobIds()) {
                if (mobId.startsWith(prefix)) {
                    suggestions.add(mobId);
                }
            }
            return suggestions;
        }
        return super.getWord(commandSender, args);
    }
}

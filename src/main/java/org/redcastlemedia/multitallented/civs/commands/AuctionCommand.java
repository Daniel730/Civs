package org.redcastlemedia.multitallented.civs.commands;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.auction.AuctionResult;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.util.Constants;
import org.redcastlemedia.multitallented.civs.util.Util;

@CivsCommand(keys = { "auction" })
public class AuctionCommand extends CivCommand {

    @Override
    public boolean runCommand(CommandSender commandSender, Command command, String label, String[] args) {
        if (!ConfigManager.getInstance().isUseAuctionHouse()) {
            commandSender.sendMessage(Civs.getPrefix() + "Auction house is disabled.");
            return true;
        }
        if (!(commandSender instanceof Player player)) {
            commandSender.sendMessage(Civs.getPrefix() + "Players only.");
            return true;
        }
        if (Civs.perm != null && !Civs.perm.has(player, Constants.AUCTION_PERMISSION)) {
            player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance().getTranslation(player, "no-permission"));
            return true;
        }
        if (Civs.econ == null) {
            player.sendMessage(Civs.getPrefix() + "Economy is not available.");
            return true;
        }

        String sub = args.length < 2 ? "browse" : args[1].toLowerCase();
        switch (sub) {
            case "browse":
            case "shop":
                MenuManager.clearHistory(player.getUniqueId());
                MenuManager.getInstance().openMenu(player, "auction-browse", new HashMap<>());
                return true;
            case "sell":
                return handleSell(player, args);
            case "cancel":
                return handleCancel(player, args);
            case "my":
            case "listings":
                MenuManager.clearHistory(player.getUniqueId());
                MenuManager.getInstance().openMenu(player, "auction-my-listings", new HashMap<>());
                return true;
            case "claim":
                return handleClaim(player);
            default:
                player.sendMessage(Civs.getPrefix() + "Usage: /civs auction [browse|sell <price>|cancel <id>|my|claim]");
                return true;
        }
    }

    private boolean handleSell(Player player, String[] args) {
        if (args.length < 3) {
            player.sendMessage(Civs.getPrefix() + "Usage: /civs auction sell <price>");
            return true;
        }
        double price;
        try {
            price = Double.parseDouble(args[2]);
        } catch (NumberFormatException e) {
            player.sendMessage(Civs.getPrefix() + "Invalid price.");
            return true;
        }
        ItemStack hand = player.getInventory().getItemInMainHand();
        AuctionResult result = AuctionManager.getInstance().listItem(player, hand, price);
        sendResult(player, result, "auction-listed", price);
        return true;
    }

    private boolean handleCancel(Player player, String[] args) {
        if (args.length < 3) {
            player.sendMessage(Civs.getPrefix() + "Usage: /civs auction cancel <id>");
            return true;
        }
        AuctionResult result = AuctionManager.getInstance().cancelListing(player, args[2]);
        sendResult(player, result, "auction-cancelled", 0);
        return true;
    }

    private boolean handleClaim(Player player) {
        AuctionResult result = AuctionManager.getInstance().claimReturns(player);
        sendResult(player, result, "auction-claimed", 0);
        return true;
    }

    private void sendResult(Player player, AuctionResult result, String successKey, double price) {
        LocaleManager localeManager = LocaleManager.getInstance();
        switch (result) {
            case SUCCESS:
                if (price > 0) {
                    String locale = CivilianManager.getInstance().getCivilian(player.getUniqueId()).getLocale();
                    player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, successKey)
                            .replace("$1", Util.getNumberFormat(price, locale)));
                } else {
                    player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, successKey));
                }
                break;
            case DISABLED:
                player.sendMessage(Civs.getPrefix() + "Auction house is disabled.");
                break;
            case NO_ECONOMY:
                player.sendMessage(Civs.getPrefix() + "Economy is not available.");
                break;
            case INVALID_ITEM:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-no-item"));
                break;
            case INVALID_PRICE:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-invalid-price"));
                break;
            case INSUFFICIENT_FUNDS:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "not-enough-money")
                        .replace("$1", String.valueOf(price)));
                break;
            case MAX_LISTINGS:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-max-listings"));
                break;
            case NOT_FOUND:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-not-found"));
                break;
            case NOT_OWNER:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "no-permission"));
                break;
            case CANNOT_BUY_OWN:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cannot-buy-own"));
                break;
            case EXPIRED:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-expired"));
                break;
            case INVENTORY_FULL:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "inventory-full"));
                break;
            case EVENT_CANCELLED:
                player.sendMessage(Civs.getPrefix() + localeManager.getTranslation(player, "auction-cancelled-event"));
                break;
            default:
                break;
        }
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
            for (String sub : List.of("browse", "sell", "cancel", "my", "claim")) {
                if (sub.startsWith(prefix)) {
                    suggestions.add(sub);
                }
            }
            return suggestions;
        }
        if (args.length == 3 && "cancel".equalsIgnoreCase(args[1]) && commandSender instanceof Player player) {
            List<String> ids = new ArrayList<>();
            String prefix = args[2].toLowerCase();
            AuctionManager.getInstance().getListingsForSeller(player.getUniqueId()).forEach(listing -> {
                if (listing.getId().toLowerCase().startsWith(prefix)) {
                    ids.add(listing.getId());
                }
            });
            return ids;
        }
        if (args.length == 3 && "sell".equalsIgnoreCase(args[1])) {
            return getListOfAmounts();
        }
        return super.getWord(commandSender, args);
    }
}

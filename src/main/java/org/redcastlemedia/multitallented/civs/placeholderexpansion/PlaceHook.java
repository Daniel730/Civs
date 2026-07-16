package org.redcastlemedia.multitallented.civs.placeholderexpansion;


import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.alliances.Alliance;
import org.redcastlemedia.multitallented.civs.alliances.AllianceManager;
import org.redcastlemedia.multitallented.civs.auction.AuctionManager;
import org.redcastlemedia.multitallented.civs.chat.ChatManager;
import org.redcastlemedia.multitallented.civs.civilians.Bounty;
import org.redcastlemedia.multitallented.civs.civilians.ChatChannel;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.skills.Skill;
import org.redcastlemedia.multitallented.civs.stats.StatManager;
import org.redcastlemedia.multitallented.civs.stats.TerritorialStat;
import org.redcastlemedia.multitallented.civs.towns.Town;
import org.redcastlemedia.multitallented.civs.towns.TownManager;
import org.redcastlemedia.multitallented.civs.util.Util;

public class PlaceHook extends PlaceholderExpansion {

    private static final String ROOT_ID = "civs";
    private static final String TOWN_NAME = "townname";
    private static final String KARMA = "karma";
    private static final String HARDSHIP = "hardship";
    private static final String KILLS = "kills";
    private static final String KILLSTREAK = "killstreak";
    private static final String HIGHEST_KILLSTREAK = "highestkillstreak";
    private static final String DEATHS = "deaths";
    private static final String POINTS = "points";
    private static final String HIGHEST_BOUNTY = "highestbounty";
    private static final String MANA = "mana";
    private static final String MAX_MANA = "max_mana";
    private static final String MANA_PAIR = "mana_pair";
    private static final String NATION = "nation";
    private static final String POWER = "power";
    private static final String MAX_POWER = "max_power";
    private static final String POPULATION = "population";
    private static final String HOUSING = "housing";
    private static final String CHAT_CHANNEL_NAME = "chatchannel";
    private static final String TOWN_BANK = "townbank";
    private static final String AUCTION_LISTINGS = "auction_listings";
    private static final String AUCTION_MY_LISTINGS = "auction_my_listings";

    @Override
    public boolean canRegister() {
        return true;
    }

    @Override
    public String getIdentifier() {
        return ROOT_ID;
    }

    @Override
    public String getAuthor() {
        return Civs.getInstance().getDescription().getAuthors().toString();
    }

    @Override
    public String getVersion() {
        return Civs.getInstance().getDescription().getVersion();
    }

    @Override
    public String onRequest(OfflinePlayer player, String identifier) {
        if (player == null) {
            return "";
        }
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        return routePlaceholder(civilian, identifier, player);
    }
    @Override
    public String onPlaceholderRequest(Player player, String identifier) {
        if (player == null) {
            return "";
        }
        Civilian civilian = CivilianManager.getInstance().getCivilian(player.getUniqueId());
        return routePlaceholder(civilian, identifier, player);
    }

    private String routePlaceholder(Civilian civilian, String identifier, OfflinePlayer player) {
        if (TOWN_NAME.equals(identifier)) {
            return TownManager.getInstance().getBiggestTown(civilian);
        } else if (POWER.equals(identifier)) {
            Town town = TownManager.getInstance().getTown(TownManager.getInstance().getBiggestTown(civilian));
            if (town == null) {
                return "-";
            }
            return "" + town.getPower();
        } else if (MAX_POWER.equals(identifier)) {
            Town town = TownManager.getInstance().getTown(TownManager.getInstance().getBiggestTown(civilian));
            if (town == null) {
                return "-";
            }
            return "" + town.getMaxPower();
        } else if (POPULATION.equals(identifier)) {
            Town town = TownManager.getInstance().getTown(TownManager.getInstance().getBiggestTown(civilian));
            if (town == null) {
                return "-";
            }
            return "" + town.getPopulation();

        } else if (TOWN_BANK.equals(identifier)) {
            Town town = TownManager.getInstance().getTown(TownManager.getInstance().getBiggestTown(civilian));
            if (town == null) {
                return "-";
            }
            return "" + Util.getNumberFormat(town.getBankAccount(), civilian.getLocale());

        } else if (HOUSING.equals(identifier)) {
            Town town = TownManager.getInstance().getTown(TownManager.getInstance().getBiggestTown(civilian));
            if (town == null) {
                return "-";
            }
            return "" + town.getHousing();
        } else if (KARMA.equals(identifier)) {
            return "" + civilian.getKarma();
        } else if (HARDSHIP.equals(identifier)) {
            return "" + (int) civilian.getHardship();
        } else if (KILLS.equals(identifier)) {
            return "" + civilian.getKills();
        } else if (KILLSTREAK.equals(identifier)) {
            return "" + civilian.getKillStreak();
        } else if (HIGHEST_KILLSTREAK.equals(identifier)) {
            return "" + civilian.getHighestKillStreak();
        } else if (DEATHS.equals(identifier)) {
            return "" + civilian.getDeaths();
        } else if (POINTS.equals(identifier)) {
            return "" + (int) civilian.getPoints();
        } else if (MANA.equals(identifier)) {
            return "" + civilian.getMana();
        } else if (MAX_MANA.equals(identifier)) {
            if (civilian.getCurrentClass() == null) {
                return "0";
            }
            return "" + civilian.getCurrentClass().getMaxMana();
        } else if (MANA_PAIR.equals(identifier)) {
            int max = civilian.getCurrentClass() != null ? civilian.getCurrentClass().getMaxMana() : 0;
            return civilian.getMana() + "/" + max;
        } else if (CHAT_CHANNEL_NAME.equals(identifier)) {
            if (ChatChannel.ChatChannelType.GLOBAL == civilian.getChatChannel().getChatChannelType()) {
                return "";
            }
            return civilian.getChatChannel().getName(player);
        } else if (HIGHEST_BOUNTY.equals(identifier)) {
            Bounty bounty = civilian.getHighestBounty();
            if (bounty == null) {
                return "-";
            }
            String bountyString = Util.getNumberFormat(bounty.getAmount(), civilian.getLocale());
            if (bounty.getIssuer() == null) {
                return "Unknown $" + bountyString;
            }

            OfflinePlayer offlinePlayer = Bukkit.getOfflinePlayer(bounty.getIssuer());
            if (offlinePlayer.getName() == null) {
                return "Unknown $" + bountyString;
            }
            return offlinePlayer.getName() + " $" + bountyString;
        } else if (NATION.equals(identifier)) {
            String nation = ChatManager.getNation(civilian);
            if (nation == null) {
                return TownManager.getInstance().getBiggestTown(civilian);
            }
            return nation;
        } else if (identifier.startsWith("skill_")) {
            return resolveSkillPlaceholder(civilian, identifier);
        } else if (identifier.startsWith("stat_")) {
            return resolveStatPlaceholder(civilian, identifier);
        } else if (AUCTION_LISTINGS.equals(identifier)) {
            return String.valueOf(AuctionManager.getInstance().getActiveListingCount());
        } else if (AUCTION_MY_LISTINGS.equals(identifier)) {
            return String.valueOf(AuctionManager.getInstance().getListingCountForSeller(civilian.getUuid()));
        } else {
            return "-";
        }
    }

    private String resolveSkillPlaceholder(Civilian civilian, String identifier) {
        if (identifier.endsWith("_level")) {
            String skillKey = identifier.substring("skill_".length(), identifier.length() - "_level".length());
            Skill skill = findSkill(civilian, skillKey);
            return skill == null ? "0" : String.valueOf(skill.getLevel());
        }
        if (identifier.endsWith("_xp")) {
            String skillKey = identifier.substring("skill_".length(), identifier.length() - "_xp".length());
            Skill skill = findSkill(civilian, skillKey);
            return skill == null ? "0" : String.valueOf((int) skill.getTotalExp());
        }
        return "0";
    }

    private Skill findSkill(Civilian civilian, String name) {
        if (name == null || name.isEmpty()) {
            return null;
        }
        Skill skill = civilian.getSkills().get(name.toLowerCase());
        if (skill != null) {
            return skill;
        }
        for (Skill current : civilian.getSkills().values()) {
            if (current.getType().equalsIgnoreCase(name)) {
                return current;
            }
        }
        return null;
    }

    private String resolveStatPlaceholder(Civilian civilian, String identifier) {
        String statKey = identifier.substring("stat_".length());
        TerritorialStat stat = TerritorialStat.fromKey(statKey);
        if (stat == null) {
            return "0";
        }
        return String.valueOf(StatManager.getInstance().getStatValue(civilian.getUuid(), stat));
    }

}

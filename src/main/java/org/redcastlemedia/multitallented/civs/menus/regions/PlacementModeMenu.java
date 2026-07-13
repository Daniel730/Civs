package org.redcastlemedia.multitallented.civs.menus.regions;

import java.util.HashMap;
import java.util.Map;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.items.CVItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;
import org.redcastlemedia.multitallented.civs.localization.LocaleManager;
import org.redcastlemedia.multitallented.civs.menus.CivsMenu;
import org.redcastlemedia.multitallented.civs.menus.CustomMenu;
import org.redcastlemedia.multitallented.civs.menus.MenuIcon;
import org.redcastlemedia.multitallented.civs.menus.MenuManager;
import org.redcastlemedia.multitallented.civs.regions.RegionManager;
import org.redcastlemedia.multitallented.civs.regions.RegionType;
import org.redcastlemedia.multitallented.civs.regions.StructureUtil;
import org.redcastlemedia.multitallented.civs.util.Util;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementMode;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementSession;
import org.redcastlemedia.multitallented.civs.regions.placement.PlacementSessionManager;
import org.redcastlemedia.multitallented.civs.regions.placement.StructurePreviewUtil;

@CivsMenu(name = "placement-mode")
@SuppressWarnings("unused")
public class PlacementModeMenu extends CustomMenu {

    @Override
    public String beforeOpenMenu(Civilian civilian) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return null;
        }
        PlacementSession session = PlacementSessionManager.getInstance().getSession(civilian.getUuid());
        if (session == null) {
            return null;
        }
        StructurePreviewUtil.removePreview(civilian.getUuid());
        if (session.getMode() == PlacementMode.INSTANT) {
            StructurePreviewUtil.showPreview(player, session);
        } else {
            StructureUtil.showGuideBoundingBox(player, session.getTarget(), session.getRegionType(), false);
        }
        return null;
    }

    @Override
    public Map<String, Object> createData(Civilian civilian, Map<String, String> params) {
        HashMap<String, Object> data = new HashMap<>();
        if (params.containsKey("regionType")) {
            RegionType regionType = (RegionType) ItemManager.getInstance().getItemType(params.get("regionType"));
            if (regionType != null) {
                data.put("regionType", regionType);
            }
        }
        return data;
    }

    @Override
    protected ItemStack createItemStack(Civilian civilian, MenuIcon menuIcon, int count) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return super.createItemStack(civilian, menuIcon, count);
        }
        RegionType regionType = (RegionType) MenuManager.getData(civilian.getUuid(), "regionType");

        if ("title".equals(menuIcon.getKey()) && regionType != null) {
            CVItem cvItem = CVItem.createCVItemFromString(regionType.getShopIcon(player).getMat().name());
            cvItem.setDisplayName(LocaleManager.getInstance().getTranslation(player, "placement-mode-title")
                    .replace("$1", regionType.getDisplayName(player)));
            cvItem.setLore(Util.textWrap(civilian, LocaleManager.getInstance().getTranslation(player, "placement-mode-desc")
                    .replace("$1", regionType.getDisplayName(player))));
            return cvItem.createItemStack();
        }
        if ("instant".equals(menuIcon.getKey()) && regionType != null
                && !regionType.isInstantBuildAvailable()) {
            CVItem cvItem = CVItem.createCVItemFromString("BARRIER");
            cvItem.setDisplayName(LocaleManager.getInstance().getTranslation(player, "placement-mode-instant"));
            cvItem.setLore(Util.textWrap(civilian, LocaleManager.getInstance().getTranslation(player, "placement-mode-instant-unavailable")));
            return cvItem.createItemStack();
        }
        return super.createItemStack(civilian, menuIcon, count);
    }

    @Override
    public boolean doActionAndCancel(Civilian civilian, String actionString, ItemStack itemStack) {
        Player player = Bukkit.getPlayer(civilian.getUuid());
        if (player == null) {
            return true;
        }
        PlacementSession session = PlacementSessionManager.getInstance().getSession(civilian.getUuid());
        if (session == null) {
            player.closeInventory();
            return true;
        }

        switch (actionString) {
            case "mode-manual" -> {
                session.setMode(PlacementMode.MANUAL);
                StructurePreviewUtil.removePreview(civilian.getUuid());
                StructureUtil.showGuideBoundingBox(player, session.getTarget(), session.getRegionType(), false);
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                        .getTranslation(player, "placement-mode-selected-manual"));
                return true;
            }
            case "mode-instant" -> {
                RegionType regionType = session.getRegionType();
                if (regionType == null) {
                    player.closeInventory();
                    return true;
                }
                if (!regionType.isInstantBuildAvailable()) {
                    player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                            .getTranslation(player, "placement-mode-instant-unavailable"));
                    return true;
                }
                session.setMode(PlacementMode.INSTANT);
                StructurePreviewUtil.showPreview(player, session);
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                        .getTranslation(player, "placement-mode-selected-instant"));
                return true;
            }
            case "placement-confirm" -> {
                if (session.getMode() == PlacementMode.UNSET) {
                    player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                            .getTranslation(player, "placement-mode-not-selected"));
                    return true;
                }
                if (session.getRegionType() == null || session.getTarget() == null) {
                    PlacementSessionManager.getInstance().clearSession(civilian.getUuid());
                    player.closeInventory();
                    return true;
                }
                player.closeInventory();
                StructurePreviewUtil.removePreview(civilian.getUuid());
                boolean success = RegionManager.getInstance().executePlacement(player, session);
                if (success) {
                    StructureUtil.removeBoundingBox(civilian.getUuid());
                    PlacementSessionManager.getInstance().clearSession(civilian.getUuid());
                }
                return true;
            }
            case "placement-cancel" -> {
                StructurePreviewUtil.removePreview(civilian.getUuid());
                StructureUtil.removeBoundingBox(civilian.getUuid());
                PlacementSessionManager.getInstance().clearSession(civilian.getUuid());
                player.closeInventory();
                player.sendMessage(Civs.getPrefix() + LocaleManager.getInstance()
                        .getTranslation(player, "placement-mode-cancelled"));
                return true;
            }
            default -> {
                return super.doActionAndCancel(civilian, actionString, itemStack);
            }
        }
    }
}

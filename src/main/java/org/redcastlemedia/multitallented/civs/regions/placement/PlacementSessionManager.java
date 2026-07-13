package org.redcastlemedia.multitallented.civs.regions.placement;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.CivsSingleton;
import org.redcastlemedia.multitallented.civs.regions.StructureUtil;

@CivsSingleton
public class PlacementSessionManager implements Listener {
    private static PlacementSessionManager instance;
    private final Map<UUID, PlacementSession> sessions = new HashMap<>();

    public static PlacementSessionManager getInstance() {
        if (instance == null) {
            instance = new PlacementSessionManager();
            if (Civs.getInstance() != null) {
                Civs.getInstance().getServer().getPluginManager().registerEvents(instance, Civs.getInstance());
            }
        }
        return instance;
    }

    public void putSession(UUID playerId, PlacementSession session) {
        sessions.put(playerId, session);
    }

    public PlacementSession getSession(UUID playerId) {
        PlacementSession session = sessions.get(playerId);
        if (session != null && session.isExpired()) {
            sessions.remove(playerId);
            return null;
        }
        return session;
    }

    public void clearSession(UUID playerId) {
        sessions.remove(playerId);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        UUID playerId = event.getPlayer().getUniqueId();
        sessions.remove(playerId);
        StructurePreviewUtil.removePreview(playerId);
        StructureUtil.removeBoundingBox(playerId);
    }
}

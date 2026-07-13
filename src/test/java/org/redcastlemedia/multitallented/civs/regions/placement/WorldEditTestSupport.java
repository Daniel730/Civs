package org.redcastlemedia.multitallented.civs.regions.placement;

import com.sk89q.worldedit.LocalConfiguration;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.entity.Player;
import com.sk89q.worldedit.event.platform.PlatformsRegisteredEvent;
import com.sk89q.worldedit.extension.platform.AbstractPlatform;
import com.sk89q.worldedit.extension.platform.Capability;
import com.sk89q.worldedit.extension.platform.PlatformManager;
import com.sk89q.worldedit.extension.platform.Preference;
import com.sk89q.worldedit.util.SideEffect;
import com.sk89q.worldedit.world.DataFixer;
import com.sk89q.worldedit.world.World;
import com.sk89q.worldedit.world.registry.BundledRegistries;
import com.sk89q.worldedit.world.registry.Registries;
import org.enginehub.piston.CommandManager;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Boots a minimal WorldEdit platform so {@code BlockTypes} and clipboard tests work without a live server plugin.
 */
public final class WorldEditTestSupport {

    private static boolean initialized;

    private WorldEditTestSupport() {
    }

    public static void ensureInitialized() {
        if (initialized) {
            return;
        }
        try {
            WorldEdit worldEdit = WorldEdit.getInstance();
            PlatformManager platformManager = worldEdit.getPlatformManager();
            platformManager.register(new BundledTestPlatform());
            platformManager.handlePlatformsRegistered(new PlatformsRegisteredEvent());
            worldEdit.loadMappings();
            initialized = true;
        } catch (Throwable ignored) {
            initialized = false;
        }
    }

    /**
     * Returns true only when WorldEdit's block registry actually initialized in this JVM.
     * The bundled test platform is not always sufficient to populate {@code BlockTypes}
     * (WorldEdit needs its full Bukkit adapter for that), so blueprint-generation tests
     * must skip gracefully rather than fail the whole build when the registry is unavailable.
     */
    public static boolean isBlockRegistryReady() {
        try {
            ensureInitialized();
            return com.sk89q.worldedit.world.block.BlockTypes.OAK_PLANKS != null;
        } catch (Throwable t) {
            return false;
        }
    }

    private static final class BundledTestPlatform extends AbstractPlatform {
        private final BundledRegistries registries = BundledRegistries.getInstance();

        @Override
        public Registries getRegistries() {
            return registries;
        }

        @Override
        public int getDataVersion() {
            return 4556;
        }

        @Override
        public DataFixer getDataFixer() {
            return new DataFixer() {
                @Override
                public <T> T fixUp(FixType<T> fixType, T object, int version) {
                    return object;
                }
            };
        }

        @Override
        public boolean isValidMobType(String type) {
            return false;
        }

        @Override
        public List<? extends World> getWorlds() {
            return Collections.emptyList();
        }

        @Override
        public Player matchPlayer(Player player) {
            return player;
        }

        @Override
        public World matchWorld(World world) {
            return world;
        }

        @Override
        public void registerCommands(CommandManager manager) {
        }

        @Override
        public void setGameHooksEnabled(boolean enabled) {
        }

        private final LocalConfiguration configuration;

        private BundledTestPlatform() {
            configuration = org.mockito.Mockito.mock(LocalConfiguration.class);
            try {
                Path dir = Files.createTempDirectory("civs-we-test");
                dir.toFile().deleteOnExit();
                org.mockito.Mockito.when(configuration.getWorkingDirectoryPath()).thenReturn(dir);
                org.mockito.Mockito.when(configuration.getWorkingDirectory()).thenReturn(dir.toFile());
            } catch (java.io.IOException e) {
                throw new RuntimeException(e);
            }
        }

        @Override
        public LocalConfiguration getConfiguration() {
            return configuration;
        }

        @Override
        public String getVersion() {
            return "7.3.13";
        }

        @Override
        public String getPlatformName() {
            return "CivsTest";
        }

        @Override
        public String getPlatformVersion() {
            return "7.3.13";
        }

        @Override
        public Map<Capability, Preference> getCapabilities() {
            Map<Capability, Preference> capabilities = new EnumMap<>(Capability.class);
            for (Capability capability : Capability.values()) {
                capabilities.put(capability, Preference.NORMAL);
            }
            return capabilities;
        }

        @Override
        public Set<SideEffect> getSupportedSideEffects() {
            return Collections.emptySet();
        }
    }
}

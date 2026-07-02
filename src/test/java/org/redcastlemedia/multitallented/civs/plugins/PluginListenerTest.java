package org.redcastlemedia.multitallented.civs.plugins;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;

import org.bukkit.event.server.PluginEnableEvent;
import org.bukkit.plugin.Plugin;
import org.junit.After;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.worldedit.WorldEditSessionListener;

// Covers the WorldEdit PluginEnableEvent fallback added to mirror the existing dynmap
// fallback: when WorldEdit finishes enabling *after* Civs has already started (so
// Civs#fancyPrintLog's startup check missed it), PluginListener should hook
// WorldEditSessionListener itself, but only when safe-worldedit is turned on.
public class PluginListenerTest extends TestUtil {

    @After
    public void tearDown() throws Exception {
        setSafeWE(false);
        setWorldEditInitialized(false);
    }

    @Test
    public void worldEditEnableShouldNotHookWhenSafeWEDisabled() throws Exception {
        setSafeWE(false);
        when(TestUtil.pluginManager.isPluginEnabled("WorldEdit")).thenReturn(true);

        new PluginListener().onPluginEnable(new PluginEnableEvent(mockPlugin("WorldEdit")));

        assertFalse(isWorldEditInitialized());
    }

    @Test
    public void worldEditEnableAfterCivsShouldHookWhenSafeWEEnabled() throws Exception {
        setSafeWE(true);
        when(TestUtil.pluginManager.isPluginEnabled("WorldEdit")).thenReturn(true);

        new PluginListener().onPluginEnable(new PluginEnableEvent(mockPlugin("WorldEdit")));

        assertTrue(isWorldEditInitialized());
    }

    private static Plugin mockPlugin(String name) {
        Plugin plugin = mock(Plugin.class);
        when(plugin.getName()).thenReturn(name);
        return plugin;
    }

    private static void setSafeWE(boolean value) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("safeWE");
        field.setAccessible(true);
        field.set(ConfigManager.getInstance(), value);
    }

    private static void setWorldEditInitialized(boolean value) throws Exception {
        Field field = WorldEditSessionListener.class.getDeclaredField("initialized");
        field.setAccessible(true);
        field.set(null, value);
    }

    private static boolean isWorldEditInitialized() throws Exception {
        Field field = WorldEditSessionListener.class.getDeclaredField("initialized");
        field.setAccessible(true);
        return field.getBoolean(null);
    }
}

package org.redcastlemedia.multitallented.civs.civclass;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;

import org.junit.Test;
import org.redcastlemedia.multitallented.civs.ConfigManager;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.items.ItemManager;

/**
 * Regression test for the per-tick {@code ClassCastException} that occurred when
 * {@code default-class} was missing or pointed at a non-class item type. Previously
 * {@link ClassManager#createDefaultClass} blindly cast the item to {@code ClassType};
 * now it falls back to any loaded class type instead of crashing every scheduler tick.
 */
public class DefaultClassFallbackTest extends TestUtil {

    private String setDefaultClass(String value) throws Exception {
        Field field = ConfigManager.class.getDeclaredField("defaultClass");
        field.setAccessible(true);
        String previous = (String) field.get(ConfigManager.getInstance());
        field.set(ConfigManager.getInstance(), value);
        return previous;
    }

    @Test
    public void fallsBackWhenConfiguredDefaultClassIsNotAClassType() throws Exception {
        // Sanity: at least one real class type is loaded in the test config set.
        assertTrue(ItemManager.getInstance().getItemType("default") instanceof ClassType);

        String previous = setDefaultClass("no_such_class_zzz");
        try {
            // Must not throw ClassCastException and must recover with a real class type.
            CivClass civClass = ClassManager.getInstance().createDefaultClass(player.getUniqueId());
            assertNotNull(civClass);
        } finally {
            setDefaultClass(previous);
        }
    }

    @Test
    public void usesConfiguredClassWhenItIsAValidClassType() throws Exception {
        String previous = setDefaultClass("default");
        try {
            CivClass civClass = ClassManager.getInstance().createDefaultClass(player.getUniqueId());
            assertNotNull(civClass);
        } finally {
            setDefaultClass(previous);
        }
    }
}

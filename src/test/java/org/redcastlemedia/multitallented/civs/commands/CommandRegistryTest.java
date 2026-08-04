package org.redcastlemedia.multitallented.civs.commands;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.junit.runners.Parameterized.Parameter;
import org.junit.runners.Parameterized.Parameters;
import org.reflections.Reflections;

/**
 * Data-driven contract tests over <b>every</b> {@code @CivsCommand}. Mirrors how
 * {@code Civs.initCommands()} loads commands (Reflections scan → {@code newInstance()} →
 * read {@code @CivsCommand.keys()}), so it catches real breakage a newly added command
 * could introduce: a missing {@code @CivsCommand} annotation (production NPEs on
 * {@code getAnnotation(...).keys()}), a missing public no-arg constructor
 * ({@code newInstance()} fails), an empty key set (unroutable), or a key that collides
 * with another command (silent route overwrite).
 */
@RunWith(Parameterized.class)
public class CommandRegistryTest {

    private static Set<Class<? extends CivCommand>> discover() {
        Reflections reflections = new Reflections("org.redcastlemedia.multitallented.civs.commands");
        Set<Class<? extends CivCommand>> all = reflections.getSubTypesOf(CivCommand.class);
        Set<Class<? extends CivCommand>> concrete = new java.util.LinkedHashSet<>();
        for (Class<? extends CivCommand> c : all) {
            if (!Modifier.isAbstract(c.getModifiers())) {
                concrete.add(c);
            }
        }
        return concrete;
    }

    @Parameter(0)
    public Class<? extends CivCommand> commandClass;

    @Parameters(name = "{0}")
    public static Collection<Object[]> data() {
        List<Object[]> params = new ArrayList<>();
        for (Class<? extends CivCommand> c : discover()) {
            params.add(new Object[] { c });
        }
        assertTrue("Expected to discover the Civs commands, found " + params.size(), params.size() >= 40);
        return params;
    }

    @Test
    public void hasCivsCommandAnnotationWithNonEmptyKeys() {
        CivsCommand annotation = commandClass.getAnnotation(CivsCommand.class);
        assertNotNull(commandClass.getSimpleName()
                + " is a CivCommand but is missing @CivsCommand; Civs.initCommands() NPEs on it",
                annotation);
        assertTrue(commandClass.getSimpleName() + " has no @CivsCommand keys (unroutable)",
                annotation.keys().length > 0);
        for (String key : annotation.keys()) {
            assertFalse(commandClass.getSimpleName() + " has a blank command key",
                    key == null || key.trim().isEmpty());
        }
    }

    @Test
    public void hasPublicNoArgConstructorAndInstantiates() throws Exception {
        // Exactly what Civs.initCommands() does; a command without a no-arg ctor fails to load.
        CivCommand instance = commandClass.getDeclaredConstructor().newInstance();
        assertNotNull(instance);
    }

    /** Not parameterized: one global assertion that no two commands claim the same key. */
    @Test
    public void noDuplicateKeysAcrossAllCommands() throws Exception {
        Map<String, String> keyOwner = new HashMap<>();
        Set<String> duplicates = new TreeSet<>();
        for (Class<? extends CivCommand> c : discover()) {
            CivsCommand annotation = c.getAnnotation(CivsCommand.class);
            if (annotation == null) {
                continue;
            }
            for (String key : annotation.keys()) {
                String previous = keyOwner.put(key, c.getSimpleName());
                if (previous != null) {
                    duplicates.add(key + " (" + previous + " & " + c.getSimpleName() + ")");
                }
            }
        }
        assertTrue("Commands share command keys (routing collision): " + duplicates,
                duplicates.isEmpty());
    }
}

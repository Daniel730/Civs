package org.redcastlemedia.multitallented.civs.registry;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.withSettings;

import org.bukkit.Keyed;
import org.bukkit.NamespacedKey;
import org.mockito.Mockito;
import org.mockito.exceptions.base.MockitoException;
import org.mockito.invocation.InvocationOnMock;
import org.mockito.stubbing.Answer;

/**
 * Builds lightweight Mockito-backed stand-ins for Paper's registry-backed
 * pseudo-enums (e.g. {@link org.bukkit.block.Biome}, {@link org.bukkit.attribute.Attribute}).
 *
 * <p>Since Paper 26.1.2, many former {@code enum}s were converted into
 * interfaces/abstract classes whose constants are resolved through
 * {@code RegistryAccess}, which in turn requires a running server
 * implementation registered via {@link java.util.ServiceLoader}. In a
 * headless unit test there is no such server, so this class provides
 * minimal, identity-consistent stand-ins: {@link Keyed#getKey()} (and the
 * default Adventure {@code key()} method that delegates to it) return the
 * requested key, and every other member falls back to Mockito's default
 * (empty/zero) answers, since unit tests in this project only rely on
 * identity/equality of these constants and never exercise their deeper
 * vanilla behaviour.</p>
 *
 * <p>Using Mockito here (rather than {@link java.lang.reflect.Proxy}) lets a
 * single implementation cover interfaces, abstract classes and final
 * classes alike, since Mockito's inline mock maker (the default since
 * Mockito 5) can mock all three.</p>
 */
final class FakeKeyedProxy {
    private FakeKeyedProxy() {
    }

    static <T extends Keyed> T create(Class<T> type, NamespacedKey key) {
        T instance;
        try {
            instance = mock(type, withSettings()
                    .defaultAnswer(new NameAwareAnswer(key))
                    .lenient());
        } catch (MockitoException e) {
            throw new IllegalStateException("Unable to fake registry value of type "
                    + type.getName() + " for key " + key + ". Add explicit support for this "
                    + "type in FakeRegistryAccess/FakeKeyedProxy.", e);
        }
        when(instance.getKey()).thenReturn(key);
        return instance;
    }

    /**
     * Delegates to real (default) interface/abstract-class method bodies
     * when present (e.g. {@code Keyed.key()} delegating to {@code getKey()}),
     * and otherwise falls back to Mockito's built-in smart-null/empty
     * answers so unstubbed calls don't throw.
     */
    private static final class NameAwareAnswer implements Answer<Object> {
        private final NamespacedKey key;

        private NameAwareAnswer(NamespacedKey key) {
            this.key = key;
        }

        @Override
        public Object answer(InvocationOnMock invocation) throws Throwable {
            if (invocation.getMethod().isDefault()) {
                return Mockito.CALLS_REAL_METHODS.answer(invocation);
            }
            if (invocation.getMethod().getName().equals("toString") && invocation.getMethod().getParameterCount() == 0) {
                return key.toString();
            }
            return Mockito.RETURNS_DEFAULTS.answer(invocation);
        }
    }
}

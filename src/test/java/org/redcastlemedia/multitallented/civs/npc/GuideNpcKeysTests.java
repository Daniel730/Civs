package org.redcastlemedia.multitallented.civs.npc;

import java.lang.reflect.Field;

import org.bukkit.NamespacedKey;
import org.bukkit.entity.Villager;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class GuideNpcKeysTests extends TestUtil {

    @Before
    public void initKeys() throws Exception {
        Field field = GuideNpcKeys.class.getDeclaredField("guideIdKey");
        field.setAccessible(true);
        field.set(null, new NamespacedKey("civs", "guide_npc_id"));
    }

    @Test
    public void writeGuideIdLowercasesValue() {
        Villager villager = mock(Villager.class);
        PersistentDataContainer pdc = mock(PersistentDataContainer.class);
        when(villager.getPersistentDataContainer()).thenReturn(pdc);

        GuideNpcKeys.writeGuideId(villager, "Guardiao_Trono");
        verify(pdc).set(eq(GuideNpcKeys.guideId()), eq(PersistentDataType.STRING), eq("guardiao_trono"));
    }

    @Test
    public void readGuideIdReturnsStoredValue() {
        Villager villager = mock(Villager.class);
        PersistentDataContainer pdc = mock(PersistentDataContainer.class);
        when(villager.getPersistentDataContainer()).thenReturn(pdc);
        when(pdc.get(eq(GuideNpcKeys.guideId()), eq(PersistentDataType.STRING)))
                .thenReturn("capitao_valdris");
        assertEquals("capitao_valdris", GuideNpcKeys.readGuideId(villager));
    }

    @Test
    public void readGuideIdNullWhenUntagged() {
        Villager villager = mock(Villager.class);
        PersistentDataContainer pdc = mock(PersistentDataContainer.class);
        when(villager.getPersistentDataContainer()).thenReturn(pdc);
        when(pdc.get(eq(GuideNpcKeys.guideId()), eq(PersistentDataType.STRING))).thenReturn(null);
        assertNull(GuideNpcKeys.readGuideId(villager));
    }
}

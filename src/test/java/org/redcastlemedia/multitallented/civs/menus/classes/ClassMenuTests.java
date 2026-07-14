package org.redcastlemedia.multitallented.civs.menus.classes;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civclass.CivClass;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;

public class ClassMenuTests extends TestUtil {

    @Test
    public void classNameShouldNotIncludeClassUuid() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        CivClass civClass = civilian.getCurrentClass();
        Map<String, Object> data = new ClassMenu().createData(civilian, new HashMap<>());
        String className = (String) data.get("className");
        assertNotNull(className);
        // The class display name must not have the internal class UUID appended to it.
        assertFalse("className should not contain the class UUID: " + className,
                className.contains(civClass.getId().toString()));
    }
}

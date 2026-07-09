package org.redcastlemedia.multitallented.civs.menus;

import org.redcastlemedia.multitallented.civs.civclass.CivClass;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.util.Constants;

import java.util.Map;
import java.util.UUID;

/** Safe parsing of menu query params when YAML placeholders were not substituted. */
public final class MenuParams {

    private MenuParams() {
    }

    public static boolean isUnresolvedPlaceholder(String value) {
        return value == null || value.isBlank()
                || (value.startsWith("$") && value.endsWith("$"));
    }

    public static UUID resolveUuid(Civilian civilian, Map<String, String> params) {
        return resolveUuid(civilian, params, Constants.UUID);
    }

    public static UUID resolveUuid(Civilian civilian, Map<String, String> params, String key) {
        if (!params.containsKey(key)) {
            return civilian.getUuid();
        }
        String raw = params.get(key);
        if (isUnresolvedPlaceholder(raw)) {
            return civilian.getUuid();
        }
        return UUID.fromString(raw);
    }

    public static CivClass resolveClass(Civilian civilian, Map<String, String> params) {
        if (!params.containsKey(Constants.CLASS)
                || isUnresolvedPlaceholder(params.get(Constants.CLASS))) {
            return civilian.getCurrentClass();
        }
        UUID classId = UUID.fromString(params.get(Constants.CLASS));
        for (CivClass civClass : civilian.getCivClasses()) {
            if (civClass.getId().equals(classId)) {
                return civClass;
            }
        }
        return civilian.getCurrentClass();
    }
}

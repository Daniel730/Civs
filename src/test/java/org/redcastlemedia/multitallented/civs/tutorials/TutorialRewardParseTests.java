package org.redcastlemedia.multitallented.civs.tutorials;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;

import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class TutorialRewardParseTests extends TestUtil {

    @Test
    public void permissionsRewardGoesToPermissionsNotCommands() {
        TutorialStep step = new TutorialStep();
        LinkedHashMap<String, Object> rewards = new LinkedHashMap<>();
        rewards.put("commands", Arrays.asList("say hi"));
        rewards.put("permissions", Arrays.asList("civs.shop", "civs.menu"));

        TutorialManager.getInstance().applyRewardsToStep(step, rewards);

        assertEquals(List.of("say hi"), step.getCommands());
        assertEquals(List.of("civs.shop", "civs.menu"), step.getPermissions());
        assertTrue("permissions must not overwrite commands",
                step.getCommands().size() == 1 && step.getCommands().contains("say hi"));
    }
}

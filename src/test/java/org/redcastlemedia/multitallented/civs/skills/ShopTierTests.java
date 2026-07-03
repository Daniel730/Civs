package org.redcastlemedia.multitallented.civs.skills;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;
import org.redcastlemedia.multitallented.civs.TestUtil;
import org.redcastlemedia.multitallented.civs.civilians.Civilian;
import org.redcastlemedia.multitallented.civs.civilians.CivilianManager;
import org.redcastlemedia.multitallented.civs.items.CivItem;
import org.redcastlemedia.multitallented.civs.items.ItemManager;

public class ShopTierTests extends TestUtil {

    @Before
    public void setup() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Skill building = civilian.getSkills().computeIfAbsent("building", Skill::new);
        building.getAccomplishments().clear();
        building.setBonusExp(0);
    }

    @Test
    public void tierOneShopItemsAvailableAtBuildingLevelOne() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Skill building = civilian.getSkills().get("building");
        building.addAccomplishment("hovel");

        CivItem coalShop = ItemManager.getInstance().getItemType("coal_shop");
        assertTrue(SkillManager.getInstance().isShopItemAvailable(civilian, coalShop));
    }

    @Test
    public void previousShopTierHiddenAtBuildingLevelTwo() {
        Civilian civilian = CivilianManager.getInstance().getCivilian(TestUtil.player.getUniqueId());
        Skill building = civilian.getSkills().get("building");
        building.addAccomplishment("hovel");
        building.addAccomplishment("ranch");
        building.addAccomplishment("purifier");

        CivItem coalShop = ItemManager.getInstance().getItemType("coal_shop");
        CivItem copperShop = ItemManager.getInstance().getItemType("copper_shop");
        if (SkillManager.getInstance().getShopTierCap(civilian) >= 2) {
            assertFalse(SkillManager.getInstance().isShopItemAvailable(civilian, coalShop));
            assertTrue(SkillManager.getInstance().isShopItemAvailable(civilian, copperShop));
        }
    }
}

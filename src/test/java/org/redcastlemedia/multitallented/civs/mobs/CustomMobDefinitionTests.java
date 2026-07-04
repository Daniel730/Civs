package org.redcastlemedia.multitallented.civs.mobs;

import org.bukkit.configuration.file.YamlConfiguration;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public class CustomMobDefinitionTests {

    @Test
    public void parsesBanditChiefYaml() {
        YamlConfiguration config = YamlConfiguration.loadConfiguration(new java.io.StringReader("""
                id: bandit_chief
                enabled: true
                display: custom-mob-bandit-chief
                type: PILLAGER
                health: 80
                damage: 8
                drops:
                  - material: IRON_SWORD
                    amount: 1
                    chance: 0.35
                  - material: EMERALD
                    min-amount: 2
                    max-amount: 5
                    chance: 1.0
                """));

        CustomMobDefinition definition = CustomMobDefinition.fromConfig(config, "bandit_chief");
        assertNotNull(definition);
        assertEquals("bandit_chief", definition.getId());
        assertEquals("custom-mob-bandit-chief", definition.getDisplay());
        assertEquals(org.bukkit.entity.EntityType.PILLAGER, definition.getEntityType());
        assertEquals(80.0, definition.getHealth(), 0.001);
        assertEquals(8.0, definition.getDamage(), 0.001);
        assertEquals(2, definition.getDrops().size());
        assertEquals(org.bukkit.Material.IRON_SWORD, definition.getDrops().get(0).getMaterial());
        assertEquals(0.35, definition.getDrops().get(0).getChance(), 0.001);
        assertEquals(2, definition.getDrops().get(1).getMinAmount());
        assertEquals(5, definition.getDrops().get(1).getMaxAmount());
    }

    @Test
    public void disabledMobReturnsNull() {
        YamlConfiguration config = YamlConfiguration.loadConfiguration(new java.io.StringReader("""
                enabled: false
                type: ZOMBIE
                """));
        assertNull(CustomMobDefinition.fromConfig(config, "disabled_mob"));
    }

    @Test
    public void parsesQuestHuntMobYaml() {
        YamlConfiguration config = YamlConfiguration.loadConfiguration(new java.io.StringReader("""
                id: frost_wraith
                enabled: true
                display: custom-mob-frost-wraith
                type: STRAY
                health: 60
                damage: 6
                despawn-seconds: 600
                drops:
                  - material: ICE
                    min-amount: 2
                    max-amount: 5
                    chance: 1.0
                """));

        CustomMobDefinition definition = CustomMobDefinition.fromConfig(config, "frost_wraith");
        assertNotNull(definition);
        assertEquals("frost_wraith", definition.getId());
        assertEquals(org.bukkit.entity.EntityType.STRAY, definition.getEntityType());
        assertEquals(600, definition.getDespawnSeconds());
    }
}

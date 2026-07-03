package org.redcastlemedia.multitallented.civs.skills;

import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;

import org.redcastlemedia.multitallented.civs.Civs;
import org.redcastlemedia.multitallented.civs.ConfigManager;

import lombok.Getter;
import lombok.Setter;

@Getter @Setter
public class Skill {
    private static final String BONUS_EXP_KEY = "_bonus-exp";

    private Map<String, Integer> accomplishments = new HashMap<>();
    private double bonusExp;
    private final String type;

    public Skill(String type) {
        this.type = type;
    }

    public double getTotalExp() {
        double exp = bonusExp;
        for (Map.Entry<String, Integer> accomplishment : accomplishments.entrySet()) {
            exp += getExpInCategory(accomplishment.getKey(), accomplishment.getValue());
        }
        return exp;
    }

    public double getCurrentLevelExp() {
        double totalExp = getTotalExp();
        int currentLevel = getLevel();
        currentLevel = currentLevel >= 10 ? 9 : currentLevel;
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        double expForCurrentLevel = (double) currentLevel / 10.0 * skillType.getMaxExp();
        return Math.min(skillType.getMaxExp() / 10.0, totalExp - expForCurrentLevel);
    }

    public double getExpToNextLevel() {
        double totalExp = getTotalExp();
        int currentLevel = getLevel();
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        double expForNextLevel = Math.min(currentLevel + 1, 10) / 10.0 * skillType.getMaxExp();
        return Math.max(expForNextLevel - totalExp, 0);
    }

    public String getCurrentExpAsBar(String locale) {
        StringBuilder stringBuilder = new StringBuilder();
        double currentExp = getCurrentLevelExp();
        double expToNextLevel = getExpToNextLevel();
        int lineBreakLength = ConfigManager.getInstance().getLineBreakLength(locale) * 2;
        int progress = (int) Math.floor(currentExp / (currentExp + expToNextLevel) * lineBreakLength);
        progress = Math.min(progress, lineBreakLength);
        for (int i = 0; i < progress; i++) {
            stringBuilder.append("|");
        }
        return stringBuilder.toString();
    }

    public String getExpToNextLevelAsBar(String locale) {
        StringBuilder stringBuilder = new StringBuilder();
        double currentExp = getCurrentLevelExp();
        double expToNextLevel = getExpToNextLevel();
        int lineBreakLength = ConfigManager.getInstance().getLineBreakLength(locale) * 2;
        int progress = (int) Math.floor(expToNextLevel / (currentExp + expToNextLevel) * lineBreakLength);
        progress = Math.min(progress, lineBreakLength);
        for (int i = 0; i < progress; i++) {
            stringBuilder.append("|");
        }
        return stringBuilder.toString();
    }

    public int getLevel() {
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        return Math.min(10, (int) Math.floor(10 * getTotalExp() / skillType.getMaxExp()));
    }

    public double previewAccomplishmentExp(String key) {
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        if (skillType == null || getTotalExp() >= skillType.getMaxExp()) {
            return 0;
        }
        if (!accomplishments.containsKey(key)) {
            return skillType.getExp(key, 1);
        }
        return skillType.getExp(key, accomplishments.get(key) + 1.0);
    }

    public double previewRawExp(double amount) {
        if (amount <= 0) {
            return 0;
        }
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        if (skillType == null || getTotalExp() >= skillType.getMaxExp()) {
            return 0;
        }
        return Math.min(amount, skillType.getMaxExp() - getTotalExp());
    }

    public double addAccomplishment(String key) {
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        if (getTotalExp() >= skillType.getMaxExp()) {
            return 0;
        }
        if (!accomplishments.containsKey(key)) {
            double exp = skillType.getExp(key, 1);
            accomplishments.put(key, 1);
            return exp;
        }
        int count = accomplishments.get(key);
        double exp = skillType.getExp(key, count + 1.0);
        if (exp > 0) {
            accomplishments.put(key, count + 1);
        }
        return exp;
    }

    public double addRawExp(double amount) {
        double applicable = previewRawExp(amount);
        if (applicable <= 0) {
            return 0;
        }
        bonusExp += applicable;
        return applicable;
    }

    public static String getBonusExpKey() {
        return BONUS_EXP_KEY;
    }

    public static boolean isBonusExpKey(String key) {
        return BONUS_EXP_KEY.equals(key);
    }

    private double getExpInCategory(String category, int count) {
        if (count < 1) {
            return 0;
        }
        SkillType skillType = SkillManager.getInstance().getSkillType(type);
        double exp = 0;
        if (skillType == null) {
            Civs.logger.log(Level.SEVERE, "Unable to find skill type for {0}", type);
            return exp;
        }
        do {
            double baseExp = skillType.getExceptions()
                    .getOrDefault(category, skillType.getExpPerCategory());
            exp += Math.max(0, baseExp - (skillType.getExpRepeatDecay() * (count - 1)));
            count--;
        } while (count > 0);
        return exp;
    }
}

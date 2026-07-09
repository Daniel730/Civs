package org.redcastlemedia.multitallented.civs.config;

import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.Test;
import org.yaml.snakeyaml.Yaml;

public class ServerPackSyncTests {

    private static final List<String> AUCTION_MENU_FILES = List.of(
            "auction-browse.yml",
            "auction-my-listings.yml",
            "auction-sell.yml");

    private static final List<String> AUCTION_TRANSLATION_KEYS = List.of(
            "auction-house",
            "auction-my-listings",
            "auction-sell",
            "auction-listed",
            "auction-cancelled",
            "auction-claimed",
            "auction-purchased",
            "auction-purchase-title",
            "auction-item-sold",
            "auction-no-item",
            "auction-invalid-price",
            "auction-max-listings",
            "auction-not-found",
            "auction-cannot-buy-own",
            "auction-expired",
            "auction-inventory-full",
            "auction-cancelled-event",
            "auction-failed",
            "auction-price",
            "auction-seller",
            "auction-expires",
            "auction-click-cancel",
            "auction-sell-help-title",
            "auction-sell-help-command",
            "auction-sell-help-tax",
            "auction-sell-help-duration",
            "auction-sell-help-limits",
            "auction-sell-command",
            "auction-sort-price",
            "auction-sort-price-asc",
            "auction-sort-price-desc",
            "auction-sort-name",
            "auction-sort-name-asc",
            "auction-sort-name-desc",
            "auction-filter",
            "auction-filter-hint",
            "auction-filter-active",
            "auction-filter-no-item",
            "auction-clear-filter",
            "auction-empty",
            "auction-my-empty",
            "auction-confirm-hint",
            "auction-shift-to-buy");

    @Test
    public void serverPackHasAuctionMenus() {
        File serverMenus = new File(repoRoot(), "Civs_servidor/menus");
        for (String menuFile : AUCTION_MENU_FILES) {
            assertTrue("Missing Civs_servidor menu: " + menuFile,
                    new File(serverMenus, menuFile).isFile());
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    public void serverPackHasAuctionTranslations() throws Exception {
        for (String localeFile : List.of("en.yml", "pt_br.yml")) {
            File translationFile = new File(repoRoot(), "Civs_servidor/translations/" + localeFile);
            assertTrue("Missing translation file: " + localeFile, translationFile.isFile());
            Yaml yaml = new Yaml();
            Object loaded = yaml.load(Files.readString(translationFile.toPath()));
            assertTrue(loaded instanceof java.util.Map);
            Set<String> keys = ((java.util.Map<String, Object>) loaded).keySet();
            for (String key : AUCTION_TRANSLATION_KEYS) {
                assertTrue(localeFile + " missing auction key: " + key, keys.contains(key));
            }
        }
    }

    @Test
    public void instantBuildOnlyOnHousingTypes() throws Exception {
        for (String root : List.of("Civs_servidor", "src/main/java/resources/hybrid")) {
            File itemTypes = new File(repoRoot(), root + "/item-types");
            assertTrue("Missing item-types folder: " + root, itemTypes.isDirectory());
            try (Stream<java.nio.file.Path> paths = Files.walk(itemTypes.toPath())) {
                List<File> offenders = paths
                        .filter(path -> path.toString().endsWith(".yml"))
                        .map(java.nio.file.Path::toFile)
                        .filter(ServerPackSyncTests::fileContainsInstantBuild)
                        .filter(file -> !isHousingType(file, itemTypes))
                        .collect(Collectors.toList());
                assertTrue(root + " instant-build outside housing: "
                        + offenders.stream().map(File::getPath).collect(Collectors.joining(", ")),
                        offenders.isEmpty());
            }
        }
    }

    @Test
    public void serverConfigEnablesAuctionHouse() throws Exception {
        File configFile = new File(repoRoot(), "Civs_servidor/config.yml");
        String config = Files.readString(configFile.toPath());
        assertTrue(config.contains("use-auction-house: true"));
        assertTrue(config.contains("auction-listing-tax-percent:"));
        assertTrue(config.contains("auction-purchase-feedback:"));
    }

    private static boolean fileContainsInstantBuild(File file) {
        try {
            String content = Files.readString(file.toPath());
            return Arrays.stream(content.split("\\R"))
                    .map(String::trim)
                    .anyMatch(line -> line.startsWith("instant-build:") && line.endsWith("true"));
        } catch (Exception e) {
            throw new RuntimeException("Failed to read " + file, e);
        }
    }

    private static boolean isHousingType(File file, File itemTypesRoot) {
        String relative = itemTypesRoot.toPath().relativize(file.toPath()).toString().replace('\\', '/');
        return relative.startsWith("housing/");
    }

    private static File repoRoot() {
        File dir = new File(System.getProperty("user.dir"));
        while (dir != null && !new File(dir, "Civs_servidor").isDirectory()) {
            dir = dir.getParentFile();
        }
        return dir != null ? dir : new File(".");
    }
}

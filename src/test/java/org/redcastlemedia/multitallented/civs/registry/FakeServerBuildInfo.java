package org.redcastlemedia.multitallented.civs.registry;

import java.time.Instant;
import java.util.Optional;
import java.util.OptionalInt;

import io.papermc.paper.ServerBuildInfo;
import net.kyori.adventure.key.Key;

/**
 * A {@link ServerBuildInfo} implementation loaded via {@link java.util.ServiceLoader}
 * (see {@code META-INF/services/io.papermc.paper.ServerBuildInfo}) so unit
 * tests can call {@link org.bukkit.Bukkit#setServer(org.bukkit.Server)}
 * without a running Paper server.
 *
 * <p>{@link org.bukkit.Bukkit#setServer} logs {@link org.bukkit.Bukkit#getVersionMessage()},
 * which resolves this service (via Adventure's {@code Services} helper, itself
 * backed by {@link java.util.ServiceLoader}) and calls {@link Optional#orElseThrow()}
 * on it. Without this fake provider that throws {@link java.util.NoSuchElementException}
 * - and critically, only *after* {@code Bukkit.server} has already been assigned,
 * so every subsequent test's {@code setServer} call fails instead with
 * "Cannot redefine singleton Server". Values here are arbitrary placeholders;
 * this project's tests never inspect them.</p>
 */
public class FakeServerBuildInfo implements ServerBuildInfo {
    @Override
    public Key brandId() {
        return BRAND_PAPER_ID;
    }

    @Override
    public boolean isBrandCompatible(Key brandId) {
        return BRAND_PAPER_ID.equals(brandId);
    }

    @Override
    public String brandName() {
        return "Paper";
    }

    @Override
    public String minecraftVersionId() {
        return "0.0.0-test";
    }

    @Override
    public String minecraftVersionName() {
        return "0.0.0-test";
    }

    @Override
    public OptionalInt buildNumber() {
        return OptionalInt.empty();
    }

    @Override
    public Instant buildTime() {
        return Instant.EPOCH;
    }

    @Override
    public Optional<String> gitBranch() {
        return Optional.empty();
    }

    @Override
    public Optional<String> gitCommit() {
        return Optional.empty();
    }

    @Override
    public String asString(StringRepresentation representation) {
        return minecraftVersionId();
    }
}

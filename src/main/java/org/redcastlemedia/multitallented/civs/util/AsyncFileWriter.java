package org.redcastlemedia.multitallented.civs.util;

import org.bukkit.Bukkit;
import org.redcastlemedia.multitallented.civs.Civs;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.logging.Level;

/**
 * Writes already-serialized file contents (e.g. from {@link org.bukkit.configuration.file.FileConfiguration#saveToString()})
 * to disk. Since the content is a plain String with no references to live/mutable
 * game state, it is safe to hand off to another thread once it has been produced
 * on the main thread.
 */
public final class AsyncFileWriter {

    private AsyncFileWriter() {

    }

    /**
     * Writes {@code content} to {@code file} on a Bukkit async task, falling back to a
     * synchronous write if the plugin isn't currently enabled (e.g. during tests).
     */
    public static void writeAsync(File file, String content, String fileLabel) {
        if (Civs.getInstance() == null) {
            writeSync(file, content, fileLabel);
            return;
        }
        Bukkit.getScheduler().runTaskAsynchronously(Civs.getInstance(), () -> writeSync(file, content, fileLabel));
    }

    /**
     * Writes {@code content} to {@code file} on whichever thread calls this method.
     * Used for the async save path's actual disk write, and for flushes (e.g. on
     * plugin disable) that must complete before the JVM continues shutting down.
     */
    public static void writeSync(File file, String content, String fileLabel) {
        try (Writer writer = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
            writer.write(content);
        } catch (IOException e) {
            Civs.logger.log(Level.SEVERE, "Unable to write to " + fileLabel, e);
        }
    }
}

package com.ohi.xagent.mobileexecution

import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.util.UUID
import org.json.JSONObject

internal data class MobileEnvironmentSnapshot(
    val diskUsageBytes: Long,
    val refreshedAtEpochMs: Long,
)

/**
 * Stores values that are expensive to derive from a populated rootfs.
 *
 * Capability probes remain live, while the recursive disk usage scan only runs after
 * XAgent-managed install operations. A corrupt or missing cache is treated as unknown.
 */
internal class MobileEnvironmentInventory(
    private val backendDir: File,
    private val rootfsDir: File,
) {
    private val inventoryFile = File(backendDir, INVENTORY_FILE)

    @Synchronized
    fun snapshot(): MobileEnvironmentSnapshot? {
        if (!rootfsDir.isDirectory || !inventoryFile.isFile) return null
        return runCatching {
            val json = JSONObject(inventoryFile.readText())
            require(json.getInt("schemaVersion") == SCHEMA_VERSION)
            MobileEnvironmentSnapshot(
                diskUsageBytes = json.getLong("diskUsageBytes"),
                refreshedAtEpochMs = json.getLong("refreshedAtEpochMs"),
            )
        }.getOrNull()
    }

    @Synchronized
    fun refresh(): MobileEnvironmentSnapshot {
        require(rootfsDir.isDirectory) { "cannot inventory a missing rootfs" }
        backendDir.mkdirs()
        val snapshot = MobileEnvironmentSnapshot(
            diskUsageBytes = calculateDiskUsage(),
            refreshedAtEpochMs = System.currentTimeMillis(),
        )
        val temporary = File(backendDir, "$INVENTORY_FILE.${UUID.randomUUID()}.tmp")
        temporary.writeText(
            JSONObject()
                .put("schemaVersion", SCHEMA_VERSION)
                .put("diskUsageBytes", snapshot.diskUsageBytes)
                .put("refreshedAtEpochMs", snapshot.refreshedAtEpochMs)
                .toString(),
        )
        val moved = runCatching {
            Files.move(
                temporary.toPath(),
                inventoryFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.recoverCatching {
            Files.move(
                temporary.toPath(),
                inventoryFile.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.isSuccess
        if (!moved) {
            temporary.delete()
            error("could not activate the mobile environment inventory")
        }
        return snapshot
    }

    private fun calculateDiskUsage(): Long {
        var total = 0L
        Files.walk(rootfsDir.toPath()).use { paths ->
            paths.forEach { path ->
                if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                    total = Math.addExact(total, Files.size(path))
                }
            }
        }
        return total
    }

    companion object {
        private const val SCHEMA_VERSION = 1
        private const val INVENTORY_FILE = "environment-inventory.json"
    }
}

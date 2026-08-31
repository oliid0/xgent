package com.ohi.xgent.mobileexecution

import android.content.res.AssetManager
import android.system.Os
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.zip.GZIPInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.json.JSONObject

internal class RootfsInstaller(
    private val assets: AssetManager,
    private val backendDir: File,
    private val rootfsDir: File,
) {
    fun bundledRootfsStatus(): Result<BundledRootfs> = runCatching { loadBundledRootfs() }

    fun install(): BundledRootfs {
        val bundled = loadBundledRootfs()

        backendDir.mkdirs()
        val operationId = UUID.randomUUID().toString()
        val archive = File(backendDir, "rootfs-$operationId.download")
        val staging = File(backendDir, "rootfs-$operationId.staging")
        val backup = File(backendDir, "rootfs-$operationId.backup")
        try {
            staging.mkdirs()
            copyVerifiedAsset(bundled, archive)
            extract(archive, staging)
            require(File(staging, "bin/sh").isFile) {
                "archive does not contain a usable rootfs (bin/sh is missing)"
            }
            RootfsEnvironment.prepare(staging, bundled.repositoryBranch)
            File(staging, XGENT_VERSION_FILE).apply {
                parentFile?.mkdirs()
                writeText("${bundled.distribution} ${bundled.version}\n")
            }
            replaceAtomically(staging, backup)
            return bundled
        } finally {
            archive.delete()
            if (staging.exists()) staging.deleteRecursively()
            if (backup.exists() && rootfsDir.exists()) backup.deleteRecursively()
        }
    }

    private fun loadBundledRootfs(): BundledRootfs {
        val manifest = assets.open("$ASSET_ROOT/manifest.json").bufferedReader().use { it.readText() }
        val root = JSONObject(manifest)
        require(root.getInt("schemaVersion") == MANIFEST_SCHEMA_VERSION) {
            "unsupported bundled rootfs manifest"
        }
        val archives = root.getJSONObject("archives")
        val abi = android.os.Build.SUPPORTED_ABIS.firstOrNull { archives.has(it) }
            ?: error("no bundled Alpine rootfs for this Android ABI")
        val archive = archives.getJSONObject(abi)
        val fileName = archive.getString("file")
        val sha256 = archive.getString("sha256").lowercase(Locale.US)
        require(SAFE_ASSET_NAME.matches(fileName) && SHA256_PATTERN.matches(sha256)) {
            "invalid bundled rootfs manifest entry"
        }
        return BundledRootfs(
            abi = abi,
            distribution = root.getString("distribution"),
            version = root.getString("version"),
            repositoryBranch = root.getString("repositoryBranch"),
            assetPath = "$ASSET_ROOT/$fileName",
            sha256 = sha256,
        )
    }

    private fun copyVerifiedAsset(bundled: BundledRootfs, target: File) {
        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        assets.open(bundled.assetPath, AssetManager.ACCESS_STREAMING).use { raw ->
            BufferedInputStream(raw).use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_ARCHIVE_BYTES) {
                            "bundled rootfs archive exceeds the $MAX_ARCHIVE_BYTES byte limit"
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        require(actual == bundled.sha256) {
            "bundled rootfs SHA-256 mismatch (expected ${bundled.sha256}, got $actual)"
        }
    }

    private fun extract(archive: File, target: File) {
        val links = mutableListOf<DeferredLink>()
        var entryCount = 0
        var unpackedBytes = 0L
        val archiveStream = GZIPInputStream(archive.inputStream().buffered())
        TarArchiveInputStream(archiveStream).use { tar ->
            while (true) {
                val entry = tar.nextEntry as? TarArchiveEntry ?: break
                entryCount += 1
                require(entryCount <= MAX_ENTRIES) { "rootfs archive contains too many entries" }
                val output = safeTarget(target, entry.name)
                when {
                    entry.isDirectory -> output.mkdirs()
                    entry.isSymbolicLink -> links += DeferredLink(output, entry.linkName, symbolic = true)
                    entry.isLink -> links += DeferredLink(output, entry.linkName, symbolic = false)
                    entry.isFile -> {
                        unpackedBytes += entry.size.coerceAtLeast(0)
                        require(unpackedBytes <= MAX_UNPACKED_BYTES) {
                            "rootfs expands beyond the $MAX_UNPACKED_BYTES byte limit"
                        }
                        output.parentFile?.mkdirs()
                        FileOutputStream(output).use { file -> tar.copyEntryTo(file, entry.size) }
                        runCatching { Os.chmod(output.absolutePath, entry.mode and 0x1ff) }
                    }
                }
            }
        }
        links.filterNot { it.symbolic }.forEach { link -> createHardLink(target, link) }
        links.filter { it.symbolic }.forEach { link -> createSymbolicLink(target, link) }
    }

    private fun TarArchiveInputStream.copyEntryTo(output: FileOutputStream, declaredSize: Long) {
        var remaining = declaredSize.coerceAtLeast(0)
        val buffer = ByteArray(BUFFER_SIZE)
        while (remaining > 0) {
            val count = read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (count < 0) throw IOException("unexpected EOF inside rootfs tar entry")
            output.write(buffer, 0, count)
            remaining -= count
        }
    }

    private fun createHardLink(root: File, link: DeferredLink) {
        val source = safeTarget(root, link.linkName)
        require(source.isFile) { "rootfs hardlink source is missing: ${link.linkName}" }
        link.target.parentFile?.mkdirs()
        link.target.delete()
        runCatching { java.nio.file.Files.createLink(link.target.toPath(), source.toPath()) }
            .recoverCatching {
                source.copyTo(link.target, overwrite = true)
                runCatching { Os.chmod(link.target.absolutePath, Os.stat(source.absolutePath).st_mode) }
            }
            .getOrThrow()
    }

    private fun createSymbolicLink(root: File, link: DeferredLink) {
        require(link.linkName.isNotBlank() && !link.linkName.contains('\u0000')) {
            "rootfs symlink has an invalid target"
        }
        if (!File(link.linkName).isAbsolute) {
            val resolved = File(link.target.parentFile ?: root, link.linkName).canonicalFile
            require(resolved.isWithin(root.canonicalFile)) {
                "rootfs symlink escapes the extraction root: ${link.target.name}"
            }
        }
        link.target.parentFile?.mkdirs()
        link.target.delete()
        java.nio.file.Files.createSymbolicLink(
            link.target.toPath(),
            java.nio.file.Paths.get(link.linkName),
        )
    }

    private fun safeTarget(root: File, rawName: String): File {
        val name = rawName.replace('\\', '/').trimStart('/').removePrefix("./")
        require(name.isNotBlank() && !name.contains('\u0000')) { "rootfs entry path is invalid" }
        require(name.split('/').none { it == ".." }) { "rootfs entry escapes the extraction root" }
        val rootFile = root.canonicalFile
        val output = File(rootFile, name)
        val canonical = output.canonicalFile
        require(canonical.isWithin(rootFile)) { "rootfs entry escapes the extraction root" }
        return output
    }

    private fun replaceAtomically(staging: File, backup: File) {
        if (backup.exists()) backup.deleteRecursively()
        if (rootfsDir.exists()) {
            require(rootfsDir.renameTo(backup)) { "could not preserve the existing rootfs" }
        }
        try {
            require(staging.renameTo(rootfsDir)) { "could not activate the new rootfs" }
            if (backup.exists()) backup.deleteRecursively()
        } catch (error: Throwable) {
            if (!rootfsDir.exists() && backup.exists()) backup.renameTo(rootfsDir)
            throw error
        }
    }

    private fun File.isWithin(root: File): Boolean =
        toPath().startsWith(root.toPath())

    private data class DeferredLink(
        val target: File,
        val linkName: String,
        val symbolic: Boolean,
    )

    companion object {
        private const val ASSET_ROOT = "mobile-execution/rootfs"
        private const val MANIFEST_SCHEMA_VERSION = 1
        private const val XGENT_VERSION_FILE = "etc/xgent-environment"
        private const val BUFFER_SIZE = 64 * 1024
        private const val MAX_ARCHIVE_BYTES = 64L * 1024 * 1024
        private const val MAX_UNPACKED_BYTES = 2L * 1024 * 1024 * 1024
        private const val MAX_ENTRIES = 250_000
        private val SHA256_PATTERN = Regex("[A-Fa-f0-9]{64}")
        private val SAFE_ASSET_NAME = Regex("[A-Za-z0-9._-]{1,128}")
    }
}

internal data class BundledRootfs(
    val abi: String,
    val distribution: String,
    val version: String,
    val repositoryBranch: String,
    val assetPath: String,
    val sha256: String,
)

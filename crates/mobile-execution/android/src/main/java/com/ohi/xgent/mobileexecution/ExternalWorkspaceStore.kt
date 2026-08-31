package com.ohi.xgent.mobileexecution

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import app.tauri.plugin.JSObject
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class ExternalWorkspaceEntry(
    val id: String,
    val name: String,
    val uri: String,
    val path: String,
    val writable: Boolean,
)

/**
 * Persistent bridge between Android's Storage Access Framework and the host
 * paths PRoot can bind as /workspace.
 *
 * Only ExternalStorageProvider trees are accepted. Cloud-provider URIs have
 * no stable POSIX path and therefore cannot be mounted into PRoot without a
 * separate mirror/synchronisation layer.
 */
internal class ExternalWorkspaceStore(private val context: Context) {
    private val preferences =
        context.getSharedPreferences("xgent-external-workspaces", Context.MODE_PRIVATE)

    @Synchronized
    fun list(): List<ExternalWorkspaceEntry> {
        val raw = preferences.getString(KEY_ENTRIES, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    val entry = ExternalWorkspaceEntry(
                        id = item.getString("id"),
                        name = item.getString("name"),
                        uri = item.getString("uri"),
                        path = item.getString("path"),
                        writable = item.optBoolean("writable", false),
                    )
                    if (File(entry.path).isDirectory && hasPersistedGrant(entry.uri)) add(entry)
                }
            }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun add(uri: Uri, allowWrite: Boolean): ExternalWorkspaceEntry {
        val path = resolvePosixPath(uri)
            ?: error("Only on-device folders can be used as PRoot workspaces")
        val canonical = File(path).canonicalFile
        require(canonical.isDirectory) { "The selected workspace is unavailable" }
        val current = list().toMutableList()
        current.firstOrNull { File(it.path).canonicalFile == canonical }?.let { return it }

        val writable = allowWrite && probeWritable(canonical)
        val displayName = DocumentsContract.getTreeDocumentId(uri)
            .substringAfter(':', canonical.name)
            .substringAfterLast('/')
            .ifBlank { canonical.name.ifBlank { "Workspace" } }
        val entry = ExternalWorkspaceEntry(
            id = UUID.randomUUID().toString(),
            name = displayName.take(80),
            uri = uri.toString(),
            path = canonical.absolutePath,
            writable = writable,
        )
        current += entry
        save(current.takeLast(MAX_WORKSPACES))
        return entry
    }

    @Synchronized
    fun remove(id: String): Boolean {
        val current = list()
        val removed = current.firstOrNull { it.id == id } ?: return false
        runCatching {
            context.contentResolver.releasePersistableUriPermission(
                Uri.parse(removed.uri),
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        save(current.filterNot { it.id == id })
        return true
    }

    fun allowedRoots(): List<File> = list().mapNotNull { entry ->
        runCatching { File(entry.path).canonicalFile.takeIf { it.isDirectory } }.getOrNull()
    }

    fun payload(entry: ExternalWorkspaceEntry): JSObject = JSObject().apply {
        put("id", entry.id)
        put("name", entry.name)
        put("path", entry.path)
        put("writable", entry.writable)
        put("active", File(entry.path).isDirectory && hasPersistedGrant(entry.uri))
        put("detail", if (entry.writable) null else "The selected folder is mounted read-only")
    }

    fun payload(): JSONArray = JSONArray().apply {
        list().forEach { put(payload(it)) }
    }

    private fun hasPersistedGrant(uri: String): Boolean =
        context.contentResolver.persistedUriPermissions.any { permission ->
            permission.uri.toString() == uri && permission.isReadPermission
        }

    private fun save(entries: List<ExternalWorkspaceEntry>) {
        val array = JSONArray()
        entries.forEach { entry ->
            array.put(
                JSONObject()
                    .put("id", entry.id)
                    .put("name", entry.name)
                    .put("uri", entry.uri)
                    .put("path", entry.path)
                    .put("writable", entry.writable),
            )
        }
        preferences.edit().putString(KEY_ENTRIES, array.toString()).apply()
    }

    private fun resolvePosixPath(uri: Uri): String? {
        if (uri.authority != EXTERNAL_STORAGE_AUTHORITY) return null
        val documentId =
            runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
        val separator = documentId.indexOf(':')
        val volume = if (separator < 0) documentId else documentId.substring(0, separator)
        val relative = if (separator < 0) "" else documentId.substring(separator + 1)
        val root = if (volume.equals("primary", ignoreCase = true)) {
            Environment.getExternalStorageDirectory()
        } else {
            File("/storage/$volume")
        }
        val canonicalRoot = runCatching { root.canonicalFile }.getOrNull() ?: return null
        val target = runCatching {
            (if (relative.isBlank()) canonicalRoot else File(canonicalRoot, relative)).canonicalFile
        }.getOrNull() ?: return null
        return target
            .takeIf { it.isDirectory && it.toPath().startsWith(canonicalRoot.toPath()) }
            ?.absolutePath
    }

    private fun probeWritable(directory: File): Boolean {
        val probe = File(directory, ".xgent-write-${UUID.randomUUID()}")
        return runCatching {
            probe.outputStream().use { it.write(0) }
            true
        }.getOrDefault(false).also { runCatching { probe.delete() } }
    }

    companion object {
        private const val KEY_ENTRIES = "entries"
        private const val MAX_WORKSPACES = 12
        private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
    }
}

package com.ohi.xagent.mobileexecution

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings

internal object WorkspacePickerCoordinator {
    private var callback: ((Uri?, String?) -> Unit)? = null

    @Synchronized
    fun begin(next: (Uri?, String?) -> Unit): Boolean {
        if (callback != null) return false
        callback = next
        return true
    }

    @Synchronized
    fun complete(uri: Uri?, error: String?) {
        val pending = callback
        callback = null
        pending?.invoke(uri, error)
    }
}

/**
 * Isolated result-owning activity for ACTION_OPEN_DOCUMENT_TREE.
 *
 * A Tauri plugin is loaded after the host Activity is created, so registering
 * an ActivityResultLauncher in the plugin is not lifecycle-safe. This
 * transparent activity owns its result contract and returns the persisted URI
 * to the plugin coordinator.
 */
class WorkspacePickerActivity : Activity() {
    private var pickedUri: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            startActivityForResult(
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
                    )
                },
                REQUEST_TREE,
            )
        }
    }

    @Deprecated("Uses the stable Activity result API supported by the Tauri host minimum SDK")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_TREE -> {
                val uri = data?.data
                if (resultCode != RESULT_OK || uri == null) {
                    finishWith(null, null)
                    return
                }
                if (uri.authority != EXTERNAL_STORAGE_AUTHORITY) {
                    finishWith(null, "Only on-device folders can be mounted into PRoot")
                    return
                }
                runCatching {
                    contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                }.onFailure {
                    finishWith(null, "Could not persist access to the selected folder")
                    return
                }
                pickedUri = uri
                requestRawStorageAccessOrFinish()
            }
            REQUEST_STORAGE_SETTINGS -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
                    Environment.isExternalStorageManager()
                ) {
                    finishWith(pickedUri, null)
                } else {
                    finishWith(
                        null,
                        "All files access is required so PRoot can read the selected workspace",
                    )
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_LEGACY_STORAGE) return
        val granted = grantResults.isNotEmpty() &&
            grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        finishWith(
            pickedUri.takeIf { granted },
            if (granted) null else "Storage permission is required for the selected workspace",
        )
    }

    private fun requestRawStorageAccessOrFinish() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Environment.isExternalStorageManager()) {
                finishWith(pickedUri, null)
                return
            }
            val intent = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:$packageName"),
            )
            startActivityForResult(intent, REQUEST_STORAGE_SETTINGS)
            return
        }
        val required = buildList {
            if (checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) !=
                PackageManager.PERMISSION_GRANTED
            ) add(Manifest.permission.READ_EXTERNAL_STORAGE)
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q &&
                checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
                PackageManager.PERMISSION_GRANTED
            ) add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        if (required.isEmpty()) finishWith(pickedUri, null)
        else requestPermissions(required.toTypedArray(), REQUEST_LEGACY_STORAGE)
    }

    private fun finishWith(uri: Uri?, error: String?) {
        WorkspacePickerCoordinator.complete(uri, error)
        finish()
    }

    override fun onDestroy() {
        if (isFinishing && pickedUri == null) {
            WorkspacePickerCoordinator.complete(null, null)
        }
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_TREE = 12041
        private const val REQUEST_STORAGE_SETTINGS = 12042
        private const val REQUEST_LEGACY_STORAGE = 12043
        private const val EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"
    }
}

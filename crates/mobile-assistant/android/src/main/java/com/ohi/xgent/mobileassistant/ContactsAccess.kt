package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray

@InvokeArg
class ContactListArgs { var query: String = ""; var limit: Int = 50 }

class ContactsAccess(private val activity: Activity) {
    fun list(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(ContactListArgs::class.java) }.getOrElse {
            invoke.reject("Invalid contact request: ${it.message}"); return
        }
        if (args.limit !in 1..200 || args.query.toByteArray(Charsets.UTF_8).size > 1024) {
            invoke.reject("Contact query/limit exceeds its bound"); return
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            invoke.reject("Contacts permission is required"); return
        }
        Thread {
            runCatching {
                val resolver = activity.contentResolver
                val query = args.query.trim()
                val uri = if (query.isEmpty()) ContactsContract.Contacts.CONTENT_URI
                    else Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(query))
                val contacts = JSONArray()
                var truncated = false
                // Bound record fields as well as rows; always close provider cursors.
                fun details(uri: Uri, column: String, contactId: String, maxLength: Int): JSONArray {
                    val values = JSONArray()
                    val cursor = resolver.query(uri, arrayOf(column), "contact_id = ?", arrayOf(contactId), null)
                        ?: error("Contacts provider did not return details")
                    cursor.use {
                        while (it.moveToNext()) {
                            if (values.length() == 16) { truncated = true; break }
                            val value = it.getString(0) ?: continue
                            if (value.length > maxLength) truncated = true
                            values.put(value.take(maxLength))
                        }
                    }
                    return values
                }
                val cursor = resolver.query(uri, arrayOf(ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY), null, null,
                    ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " ASC") ?: error("Contacts provider did not return contacts")
                cursor.use {
                    while (it.moveToNext()) {
                        if (contacts.length() == args.limit) { truncated = true; break }
                        val id = it.getString(0)
                        val name = it.getString(1) ?: ""
                        if (name.length > 512) truncated = true
                        contacts.put(JSObject().apply {
                            put("id", id); put("name", name.take(512))
                            put("phones", details(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, ContactsContract.CommonDataKinds.Phone.NUMBER, id, 64))
                            put("emails", details(ContactsContract.CommonDataKinds.Email.CONTENT_URI, ContactsContract.CommonDataKinds.Email.ADDRESS, id, 320))
                        })
                    }
                }
                JSObject().apply { put("contacts", contacts); put("truncated", truncated); put("accessLimited", false) }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Unable to read authorized contacts: ${it.message}") }
        }.start()
    }
}

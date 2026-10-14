package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.content.ContentProviderOperation
import android.content.ContentUris
import android.content.ContentValues
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.TimeZone
import org.json.JSONArray

@InvokeArg
class CalendarListArgs { var kind: String = "event"; var writableOnly: Boolean = true; var calendarIds: List<String>? = null }

/** Device-authorized writes return provider IDs, never composer-open receipts. */
class CalendarWrites(private val activity: Activity) {
    private data class CalendarChoice(val id: Long, val title: String, val source: String, val sourceId: String, val primary: Boolean, val writable: Boolean)

    private fun choices(requireWrite: Boolean, writableOnly: Boolean = true, maxChoices: Int = 201, calendarIds: List<String>? = null): List<CalendarChoice> {
        val permissions = if (requireWrite) arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
            else arrayOf(Manifest.permission.READ_CALENDAR)
        for (permission in permissions) {
            check(ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) { "Calendar read/write permission is required" }
        }
        if (calendarIds != null) check(calendarIds.isNotEmpty() && calendarIds.size <= 16 && calendarIds.distinct().size == calendarIds.size && calendarIds.all { it.isNotBlank() && it.length <= 4096 }) { "Invalid or empty task calendar scope" }
        val choices = mutableListOf<CalendarChoice>()
        val selection = CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + " >= ? AND " + CalendarContract.Calendars.VISIBLE + " = 1" +
            (if (calendarIds != null) " AND ${CalendarContract.Calendars._ID} IN (${calendarIds.joinToString(",") { "?" }})" else "")
        val arguments = mutableListOf((if (writableOnly) CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR else CalendarContract.Calendars.CAL_ACCESS_READ).toString())
        if (calendarIds != null) arguments.addAll(calendarIds)
        val cursor = activity.contentResolver.query(CalendarContract.Calendars.CONTENT_URI,
            arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, CalendarContract.Calendars.IS_PRIMARY,
                CalendarContract.Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL),
            selection, arguments.toTypedArray(), CalendarContract.Calendars._ID + " ASC")
            ?: error("Calendar provider did not return calendars")
        cursor.use { while (choices.size < maxChoices && it.moveToNext()) {
            choices.add(CalendarChoice(it.getLong(0), it.getString(1) ?: "",
                listOf(it.getString(3) ?: "", it.getString(4) ?: "").filter(String::isNotEmpty).joinToString(" · "),
                JSONArray(listOf(it.getString(3) ?: "", it.getString(4) ?: "")).toString(), it.getInt(2) == 1,
                it.getInt(5) >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR))
        } }
        return choices
    }

    fun readSourceIds(calendarIds: List<String>? = null): Map<String, String> = choices(requireWrite = false, writableOnly = false, maxChoices = 4096, calendarIds = calendarIds).associate { it.id.toString() to it.sourceId }

    fun list(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CalendarListArgs::class.java) }.getOrElse {
            invoke.reject("Invalid calendar request: ${it.message}"); return
        }
        if (args.kind !in setOf("event", "reminder")) { invoke.reject("Calendar kind must be event or reminder"); return }
        Thread {
            runCatching {
                val choices = choices(false, writableOnly = args.writableOnly, calendarIds = args.calendarIds)
                val primary = choices.filter { it.primary }.singleOrNull()
                // A primary flag is not a unique default if more calendars were omitted.
                val default = if (choices.size <= 200) primary ?: choices.singleOrNull() else null
                var truncated = choices.size > 200
                val payload = JSONArray()
                for (calendar in choices.take(200)) {
                    if (calendar.title.length > 512 || calendar.source.length > 512) truncated = true
                    payload.put(JSObject().apply {
                        put("id", calendar.id.toString()); put("title", calendar.title.take(512))
                        put("source", calendar.source.take(512)); put("sourceId", calendar.sourceId); put("isDefault", calendar.id == default?.id); put("writable", calendar.writable)
                    })
                }
                JSObject().apply { put("calendars", payload); put("truncated", truncated) }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Unable to discover writable calendars: ${it.message}") }
        }.start()
    }

    private fun calendar(requestedId: String?, expectedSourceId: String?): Long {
        val choices = choices(true, calendarIds = requestedId?.let { listOf(it) })
        check(choices.size <= 200) { "Calendar discovery was truncated; cannot select an unobserved destination" }
        if (requestedId != null) {
            val selected = choices.singleOrNull { it.id.toString() == requestedId }
                ?: error("Selected calendar is not a visible writable calendar on this device")
            check(expectedSourceId == null || selected.sourceId == expectedSourceId) { "Selected calendar account changed; no write was started" }
            return selected.id
        }
        check(expectedSourceId == null) { "A bound account requires an explicit calendar ID" }
        val primary = choices.filter { it.primary }
        return primary.singleOrNull()?.id ?: choices.singleOrNull()?.id
            ?: error("Choose calendar_id using list_calendars; a unique writable default was not observed")
    }

    fun save(invoke: Invoke, title: String, start: Long, end: Long, allDay: Boolean,
        notes: String?, location: String?, recurrence: String?, calendarId: String?, expectedSourceId: String?, alarm: Boolean) {
        if (title.isBlank() || title.length > 1024 || start <= 0 || end <= start ||
            (recurrence != null && recurrence !in setOf("daily", "weekly"))) {
            invoke.reject("A bounded title, due time, valid interval and daily/weekly recurrence are required"); return
        }
        if (allDay && (start % 86_400_000L != 0L || end % 86_400_000L != 0L)) {
            invoke.reject("All-day event timestamps must be UTC midnight boundaries"); return
        }
        Thread {
            val owner = runCatching { calendar(calendarId, expectedSourceId) }.getOrElse { invoke.reject(it.message ?: "Calendar selection failed"); return@Thread }
            val values = ContentValues().apply {
                put(CalendarContract.Events.CALENDAR_ID, owner)
                put(CalendarContract.Events.TITLE, title.trim())
                put(CalendarContract.Events.DTSTART, start)
                put(CalendarContract.Events.EVENT_TIMEZONE, if (allDay) "UTC" else TimeZone.getDefault().id)
                put(CalendarContract.Events.ALL_DAY, if (allDay) 1 else 0)
                put(CalendarContract.Events.HAS_ALARM, if (alarm) 1 else 0)
                notes?.let { put(CalendarContract.Events.DESCRIPTION, it) }
                location?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
                if (recurrence == null) put(CalendarContract.Events.DTEND, end)
                else {
                    put(CalendarContract.Events.DURATION, "PT${(end - start) / 1000}S")
                    put(CalendarContract.Events.RRULE, if (recurrence == "daily") "FREQ=DAILY" else "FREQ=WEEKLY")
                }
            }
            val operations = arrayListOf(ContentProviderOperation.newInsert(CalendarContract.Events.CONTENT_URI).withValues(values).build())
            if (alarm) operations.add(ContentProviderOperation.newInsert(CalendarContract.Reminders.CONTENT_URI)
                .withValueBackReference(CalendarContract.Reminders.EVENT_ID, 0)
                .withValue(CalendarContract.Reminders.MINUTES, 0)
                .withValue(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT).build())
            // No retry: a lost/failed provider reply may have an unknown effect.
            runCatching {
                val result = activity.contentResolver.applyBatch(CalendarContract.AUTHORITY, operations)
                val uri = result.firstOrNull()?.uri ?: error("Calendar provider returned no event ID")
                val id = ContentUris.parseId(uri)
                check(id > 0) { "Calendar provider returned an invalid event ID" }
                if (alarm) {
                    val alert = result.getOrNull(1)?.uri ?: error("Calendar provider returned no alert ID")
                    check(ContentUris.parseId(alert) > 0) { "Calendar provider returned an invalid alert ID" }
                }
                JSObject().apply { put("id", id.toString()); put("presented", false); put("detail", "Saved to device calendar $owner" + if (alarm) " with a due-time alert" else "") }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Calendar write could not be confirmed. Inspect existing events before retrying: ${it.message}") }
        }.start()
    }
}

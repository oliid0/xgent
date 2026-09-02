package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.Locale
import org.json.JSONArray

private const val ALIAS_MICROPHONE = "microphone"
private const val ALIAS_CAMERA = "camera"
private const val ALIAS_CALENDAR = "calendar"
private const val ALIAS_LOCATION = "location"
private const val ALIAS_PHOTOS = "photos"
private const val ALIAS_PHOTOS_LEGACY = "photosLegacy"

@InvokeArg
class VoiceInputArgs {
    var locale: String? = null
}

@InvokeArg
class CurrentLocationArgs {
    var timeoutMs: Long = 10_000
}

@InvokeArg
class CalendarRangeArgs {
    var startMs: Long = 0
    var endMs: Long = 0
    var limit: Int = 50
}

@InvokeArg
class ReminderListArgs {
    var incompleteOnly: Boolean = true
    var limit: Int = 50
}

@InvokeArg
class CreateCalendarEventArgs {
    lateinit var title: String
    var startMs: Long = 0
    var endMs: Long = 0
    var allDay: Boolean = false
    var location: String? = null
    var notes: String? = null
}

@InvokeArg
class CreateReminderArgs {
    lateinit var title: String
    var dueMs: Long? = null
    var notes: String? = null
}

@InvokeArg
class ComposeMessageArgs {
    lateinit var kind: String
    var recipients: Array<String> = emptyArray()
    var subject: String? = null
    var body: String? = null
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = ALIAS_MICROPHONE),
        Permission(strings = [Manifest.permission.CAMERA], alias = ALIAS_CAMERA),
        Permission(
            strings = [
                Manifest.permission.READ_CALENDAR,
                Manifest.permission.WRITE_CALENDAR,
            ],
            alias = ALIAS_CALENDAR,
        ),
        Permission(
            strings = [
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ],
            alias = ALIAS_LOCATION,
        ),
        Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES], alias = ALIAS_PHOTOS),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = ALIAS_PHOTOS_LEGACY),
    ],
)
class MobileAssistantPlugin(private val activity: Activity) : Plugin(activity) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var speechRecognizer: SpeechRecognizer? = null
    private var pendingVoiceInvoke: Invoke? = null
    private var voiceTimeout: Runnable? = null
    private var pendingLocationInvoke: Invoke? = null
    private var pendingLocationManager: LocationManager? = null
    private var pendingLocationListener: LocationListener? = null
    private var locationTimeout: Runnable? = null

    @Command
    override fun checkPermissions(invoke: Invoke) {
        super.checkPermissions(invoke)
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        super.requestPermissions(invoke)
    }

    @Command
    fun status(invoke: Invoke) {
        val photoAlias = if (Build.VERSION.SDK_INT >= 33) ALIAS_PHOTOS else ALIAS_PHOTOS_LEGACY
        invoke.resolve(
            JSObject().apply {
                put("backend", "android-native")
                put("available", true)
                put("voiceInputAvailable", SpeechRecognizer.isRecognitionAvailable(activity))
                // The mobile-execution plugin owns the Storage Access
                // Framework picker and persists its URI grants. The mounted
                // directory is shared by file tools, PRoot and agent runs.
                put("externalFolderMountAvailable", true)
                put("cloudSyncAvailable", false)
                put("healthAvailable", false)
                put("homeAvailable", false)
                put(
                    "permissionAliases",
                    JSObject().apply {
                        put("microphone", ALIAS_MICROPHONE)
                        put("camera", ALIAS_CAMERA)
                        put("calendar", ALIAS_CALENDAR)
                        put("reminders", ALIAS_CALENDAR)
                        put("photos", photoAlias)
                        put("location", ALIAS_LOCATION)
                    },
                )
                put(
                    "detail",
                    "Android permissions use system runtime prompts; Health Connect requires a separate provider integration.",
                )
            },
        )
    }

    @Command
    fun startVoiceInput(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(VoiceInputArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid voice input request: ${error.message}")
                return
            }
        if (getPermissionState(ALIAS_MICROPHONE) != PermissionState.GRANTED) {
            invoke.reject("Microphone permission is required before starting voice input")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            invoke.reject("Speech recognition is not available on this Android device")
            return
        }
        if (pendingVoiceInvoke != null) {
            invoke.reject("Voice input is already active")
            return
        }

        pendingVoiceInvoke = invoke
        mainHandler.post {
            val recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
            speechRecognizer = recognizer
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit

                override fun onError(error: Int) {
                    finishVoiceError(speechErrorMessage(error))
                }

                override fun onResults(results: Bundle?) {
                    val texts = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        .orEmpty()
                    val text = texts.firstOrNull()?.trim().orEmpty()
                    if (text.isEmpty()) {
                        finishVoiceError("Speech recognition returned no text")
                        return
                    }
                    val confidence = results
                        ?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                        ?.firstOrNull()
                        ?.takeIf { it >= 0f }
                    val locale = args.locale?.trim().takeUnless { it.isNullOrEmpty() }
                        ?: Locale.getDefault().toLanguageTag()
                    finishVoiceSuccess(text, locale, confidence?.toDouble())
                }
            })

            val locale = args.locale?.trim().takeUnless { it.isNullOrEmpty() }
                ?: Locale.getDefault().toLanguageTag()
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
            }
            recognizer.startListening(intent)
            val timeout = Runnable {
                if (pendingVoiceInvoke != null) {
                    finishVoiceError("Voice input timed out")
                }
            }
            voiceTimeout = timeout
            mainHandler.postDelayed(timeout, VOICE_TIMEOUT_MS)
        }
    }

    @Command
    fun getCurrentLocation(invoke: Invoke) {
        val args = parseArgs(invoke, CurrentLocationArgs::class.java) ?: return
        if (getPermissionState(ALIAS_LOCATION) != PermissionState.GRANTED) {
            invoke.reject("Location permission is required")
            return
        }
        mainHandler.post {
            if (pendingLocationInvoke != null) {
                invoke.reject("Another location request is already active")
                return@post
            }
            val manager = activity.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            if (manager == null) {
                invoke.reject("Location service is unavailable on this device")
                return@post
            }
            val enabledProviders = runCatching {
                manager.allProviders.filter { provider -> manager.isProviderEnabled(provider) }
            }.getOrDefault(emptyList())
            if (enabledProviders.isEmpty()) {
                invoke.reject("Location services are disabled on this device")
                return@post
            }

            val cached = enabledProviders
                .mapNotNull { provider ->
                    runCatching {
                        @Suppress("MissingPermission")
                        manager.getLastKnownLocation(provider)
                    }.getOrNull()
                }
                .maxByOrNull { location -> location.time }
            if (cached != null) {
                resolveLocation(invoke, cached)
                return@post
            }

            val provider = listOf(LocationManager.NETWORK_PROVIDER, "fused", LocationManager.GPS_PROVIDER)
                .firstOrNull(enabledProviders::contains)
            if (provider == null) {
                invoke.reject("No supported location provider is enabled")
                return@post
            }
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    finishLocationSuccess(location)
                }

                override fun onProviderDisabled(disabledProvider: String) {
                    if (disabledProvider == provider) {
                        finishLocationError("The active location provider was disabled")
                    }
                }

                override fun onProviderEnabled(enabledProvider: String) = Unit

                @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            }
            pendingLocationInvoke = invoke
            pendingLocationManager = manager
            pendingLocationListener = listener
            val timeout = Runnable { finishLocationError("Location request timed out") }
            locationTimeout = timeout
            mainHandler.postDelayed(timeout, args.timeoutMs.coerceIn(1_000, 30_000))
            runCatching {
                @Suppress("MissingPermission", "DEPRECATION")
                manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }.onFailure { error ->
                finishLocationError("Unable to read location: ${error.message}")
            }
        }
    }

    @Command
    fun listCalendarEvents(invoke: Invoke) {
        val args = parseArgs(invoke, CalendarRangeArgs::class.java) ?: return
        if (!calendarPermissionGranted(invoke)) return
        if (args.endMs <= args.startMs) {
            invoke.reject("Calendar range end must be after start")
            return
        }
        Thread {
            runCatching {
                queryCalendarInstances(args.startMs, args.endMs, args.limit, remindersOnly = false)
            }.onSuccess(invoke::resolveObject).onFailure { error ->
                invoke.reject("Unable to read calendar events: ${error.message}")
            }
        }.start()
    }

    @Command
    fun listReminders(invoke: Invoke) {
        val args = parseArgs(invoke, ReminderListArgs::class.java) ?: return
        if (!calendarPermissionGranted(invoke)) return
        val now = System.currentTimeMillis()
        Thread {
            runCatching {
                queryCalendarInstances(
                    now,
                    now + REMINDER_LOOKAHEAD_MS,
                    args.limit,
                    remindersOnly = true,
                )
            }.onSuccess(invoke::resolveObject).onFailure { error ->
                invoke.reject("Unable to read Android calendar reminders: ${error.message}")
            }
        }.start()
    }

    @Command
    fun createCalendarEvent(invoke: Invoke) {
        val args = parseArgs(invoke, CreateCalendarEventArgs::class.java) ?: return
        val title = args.title.trim()
        if (title.isEmpty() || args.endMs <= args.startMs) {
            invoke.reject("A title and an end after the start are required")
            return
        }
        val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
            putExtra(CalendarContract.Events.TITLE, title)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, args.startMs)
            putExtra(CalendarContract.EXTRA_EVENT_END_TIME, args.endMs)
            putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, args.allDay)
            args.location?.trim()?.takeIf(String::isNotEmpty)?.let {
                putExtra(CalendarContract.Events.EVENT_LOCATION, it)
            }
            args.notes?.trim()?.takeIf(String::isNotEmpty)?.let {
                putExtra(CalendarContract.Events.DESCRIPTION, it)
            }
        }
        presentIntent(invoke, intent, "Calendar draft opened; the user must review and save it")
    }

    @Command
    fun createReminder(invoke: Invoke) {
        val args = parseArgs(invoke, CreateReminderArgs::class.java) ?: return
        val title = args.title.trim()
        if (title.isEmpty()) {
            invoke.reject("A reminder title is required")
            return
        }
        val due = args.dueMs ?: (System.currentTimeMillis() + DEFAULT_REMINDER_DELAY_MS)
        val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
            putExtra(CalendarContract.Events.TITLE, title)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, due)
            putExtra(CalendarContract.EXTRA_EVENT_END_TIME, due + DEFAULT_REMINDER_DURATION_MS)
            putExtra(CalendarContract.Events.HAS_ALARM, 1)
            args.notes?.trim()?.takeIf(String::isNotEmpty)?.let {
                putExtra(CalendarContract.Events.DESCRIPTION, it)
            }
        }
        presentIntent(
            invoke,
            intent,
            "Android calendar reminder draft opened; the user must choose an alert and save it",
        )
    }

    @Command
    fun composeMessage(invoke: Invoke) {
        val args = parseArgs(invoke, ComposeMessageArgs::class.java) ?: return
        val recipients = args.recipients.map(String::trim).filter(String::isNotEmpty).take(20)
        val intent = when (args.kind) {
            "email" -> Intent(
                Intent.ACTION_SENDTO,
                Uri.fromParts("mailto", recipients.joinToString(","), null),
            ).apply {
                args.subject?.trim()?.takeIf(String::isNotEmpty)?.let {
                    putExtra(Intent.EXTRA_SUBJECT, it)
                }
                args.body?.trim()?.takeIf(String::isNotEmpty)?.let {
                    putExtra(Intent.EXTRA_TEXT, it)
                }
            }
            "sms" -> Intent(
                Intent.ACTION_SENDTO,
                Uri.fromParts("smsto", recipients.joinToString(","), null),
            ).apply {
                args.body?.trim()?.takeIf(String::isNotEmpty)?.let { putExtra("sms_body", it) }
            }
            else -> {
                invoke.reject("Message kind must be email or sms")
                return
            }
        }
        presentIntent(invoke, intent, "System ${args.kind} draft opened; the user must send or cancel it")
    }

    private fun queryCalendarInstances(
        startMs: Long,
        endMs: Long,
        requestedLimit: Int,
        remindersOnly: Boolean,
    ): JSONArray {
        val uriBuilder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(uriBuilder, startMs)
        ContentUris.appendId(uriBuilder, endMs)
        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DESCRIPTION,
            CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
            CalendarContract.Instances.HAS_ALARM,
        )
        val selection = if (remindersOnly) "${CalendarContract.Instances.HAS_ALARM}=1" else null
        val result = JSONArray()
        activity.contentResolver.query(
            uriBuilder.build(),
            projection,
            selection,
            null,
            "${CalendarContract.Instances.BEGIN} ASC",
        )?.use { cursor ->
            val limit = requestedLimit.coerceIn(1, 200)
            while (cursor.moveToNext() && result.length() < limit) {
                val payload = JSObject()
                val eventId = cursor.getString(0).orEmpty()
                val title = cursor.getString(1)?.takeIf(String::isNotBlank) ?: "Untitled event"
                val begin = cursor.getLong(2)
                if (remindersOnly) {
                    payload.put("id", eventId)
                    payload.put("title", title)
                    payload.put("dueMs", begin)
                    payload.put("completed", false)
                    payload.put("notes", cursor.getString(6))
                    payload.put("list", cursor.getString(7))
                } else {
                    payload.put("id", eventId)
                    payload.put("title", title)
                    payload.put("startMs", begin)
                    payload.put("endMs", cursor.getLong(3))
                    payload.put("allDay", cursor.getInt(4) != 0)
                    payload.put("location", cursor.getString(5))
                    payload.put("notes", cursor.getString(6))
                    payload.put("calendar", cursor.getString(7))
                }
                result.put(payload)
            }
        }
        return result
    }

    private fun calendarPermissionGranted(invoke: Invoke): Boolean {
        if (getPermissionState(ALIAS_CALENDAR) == PermissionState.GRANTED) return true
        invoke.reject("Calendar permission is required")
        return false
    }

    private fun <T> parseArgs(invoke: Invoke, type: Class<T>): T? = runCatching {
        invoke.parseArgs(type)
    }.getOrElse { error ->
        invoke.reject("Invalid mobile assistant request: ${error.message}")
        null
    }

    private fun presentIntent(invoke: Invoke, intent: Intent, detail: String) {
        mainHandler.post {
            if (intent.resolveActivity(activity.packageManager) == null) {
                invoke.reject("No compatible system application is installed")
                return@post
            }
            runCatching { activity.startActivity(intent) }
                .onSuccess {
                    invoke.resolve(JSObject().apply {
                        put("id", null)
                        put("presented", true)
                        put("detail", detail)
                    })
                }
                .onFailure { error -> invoke.reject("Unable to open system application: ${error.message}") }
        }
    }

    private fun finishVoiceSuccess(text: String, locale: String, confidence: Double?) {
        val invoke = pendingVoiceInvoke ?: return
        pendingVoiceInvoke = null
        clearVoiceTimeout()
        speechRecognizer?.destroy()
        speechRecognizer = null
        invoke.resolve(
            JSObject().apply {
                put("text", text)
                put("locale", locale)
                put("confidence", confidence)
            },
        )
    }

    private fun finishVoiceError(message: String) {
        val invoke = pendingVoiceInvoke ?: return
        pendingVoiceInvoke = null
        clearVoiceTimeout()
        speechRecognizer?.destroy()
        speechRecognizer = null
        invoke.reject(message)
    }

    private fun clearVoiceTimeout() {
        voiceTimeout?.let(mainHandler::removeCallbacks)
        voiceTimeout = null
    }

    private fun resolveLocation(invoke: Invoke, location: Location) {
        invoke.resolve(
            JSObject().apply {
                put("latitude", location.latitude)
                put("longitude", location.longitude)
                put("altitudeMeters", if (location.hasAltitude()) location.altitude else null)
                put("accuracyMeters", location.accuracy.coerceAtLeast(0f).toDouble())
                put("timestampMs", location.time)
                put("provider", location.provider)
            },
        )
    }

    private fun finishLocationSuccess(location: Location) {
        val invoke = pendingLocationInvoke ?: return
        clearLocationRequest()
        resolveLocation(invoke, location)
    }

    private fun finishLocationError(message: String) {
        val invoke = pendingLocationInvoke ?: return
        clearLocationRequest()
        invoke.reject(message)
    }

    private fun clearLocationRequest() {
        locationTimeout?.let(mainHandler::removeCallbacks)
        locationTimeout = null
        val manager = pendingLocationManager
        val listener = pendingLocationListener
        pendingLocationInvoke = null
        pendingLocationManager = null
        pendingLocationListener = null
        if (manager != null && listener != null) {
            runCatching { manager.removeUpdates(listener) }
        }
    }

    private fun speechErrorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio capture failed"
        SpeechRecognizer.ERROR_CLIENT -> "Voice input was cancelled"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission was denied"
        SpeechRecognizer.ERROR_NETWORK,
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network request failed"
        SpeechRecognizer.ERROR_NO_MATCH -> "No speech was recognized"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy"
        SpeechRecognizer.ERROR_SERVER -> "Speech recognition service failed"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was detected"
        else -> "Speech recognition failed (error $error)"
    }

    override fun onPause() {
        super.onPause()
        if (pendingVoiceInvoke != null) {
            finishVoiceError("Voice input was interrupted")
        }
        if (pendingLocationInvoke != null) {
            finishLocationError("Location request was interrupted")
        }
    }

    companion object {
        private const val VOICE_TIMEOUT_MS = 30_000L
        private const val REMINDER_LOOKAHEAD_MS = 366L * 24 * 60 * 60 * 1_000
        private const val DEFAULT_REMINDER_DELAY_MS = 60L * 60 * 1_000
        private const val DEFAULT_REMINDER_DURATION_MS = 30L * 60 * 1_000
    }
}

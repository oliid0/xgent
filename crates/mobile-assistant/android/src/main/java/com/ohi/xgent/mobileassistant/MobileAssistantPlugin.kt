package com.ohi.xgent.mobileassistant

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.ClipboardManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.time.Instant
import java.util.Locale
import kotlinx.coroutines.runBlocking
import org.json.JSONArray

private const val ALIAS_MICROPHONE = "microphone"
private const val ALIAS_CAMERA = "camera"
private const val ALIAS_CALENDAR = "calendar"
private const val ALIAS_CONTACTS = "contacts"
private const val ALIAS_LOCATION = "location"
private const val ALIAS_PHOTOS = "photos"
private const val ALIAS_PHOTOS_LEGACY = "photosLegacy"
private const val ALIAS_PHOTOS_SELECTED = "photosSelected"
private const val ALIAS_HEALTH = "health"
private const val ALIAS_NOTIFICATIONS = "notifications"
private const val ALIAS_BLUETOOTH = "bluetooth"
private const val HEALTH_PROVIDER_PACKAGE = "com.google.android.apps.healthdata"

private val HEALTH_PERMISSIONS = setOf(
    HealthPermission.getReadPermission(StepsRecord::class),
)

@InvokeArg
class ClipboardArgs { var text: String = "" }

@InvokeArg
class VoiceInputArgs {
    var locale: String? = null
}

@InvokeArg
class PermissionRequestArgs {
    var permissions: List<String>? = null
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
    var calendarIds: List<String>? = null
}

@InvokeArg
class HealthStepsArgs {
    var startMs: Long = 0
    var endMs: Long = 0
}

@InvokeArg
class ReminderListArgs {
    var incompleteOnly: Boolean = true
    var limit: Int = 50
    var calendarIds: List<String>? = null
}

@InvokeArg
class CreateCalendarEventArgs {
    lateinit var title: String
    var startMs: Long = 0
    var endMs: Long = 0
    var allDay: Boolean = false
    var location: String? = null
    var notes: String? = null
    var calendarId: String? = null
    var expectedSourceId: String? = null
}

@InvokeArg
class CreateReminderArgs {
    lateinit var title: String
    var dueMs: Long? = null
    var notes: String? = null
    var recurrence: String? = null
    var calendarId: String? = null
    var expectedSourceId: String? = null
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
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = ALIAS_NOTIFICATIONS),
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = ALIAS_BLUETOOTH),
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
        Permission(strings = [Manifest.permission.READ_CONTACTS], alias = ALIAS_CONTACTS),
        Permission(strings = [Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED], alias = ALIAS_PHOTOS_SELECTED),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = ALIAS_PHOTOS_LEGACY),
    ],
)
class MobileAssistantPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun configureResultDelivery(invoke: Invoke) {
        val args = parseArgs(invoke, ResultDeliveryConfigurationArgs::class.java) ?: return
        Thread {
            runCatching { ResultDelivery.configure(activity.applicationContext, args); true }
                .onSuccess(invoke::resolveObject)
                .onFailure { invoke.reject("Unable to configure retained result delivery: ${it.message}") }
        }.start()
    }
    @Command
    fun discoverWorkstations(invoke: Invoke) {
        WorkstationDiscovery.discover(activity.applicationContext, invoke)
    }

    // Internal native setup only; absent from the public Rust command list.
    @Command
    fun configureEventDelivery(invoke: Invoke) {
        val args = parseArgs(invoke, EventDeliveryConfigurationArgs::class.java) ?: return
        Thread {
            runCatching { EventDelivery.configure(activity.applicationContext, args); true }
                .onSuccess(invoke::resolveObject).onFailure { invoke.reject("Native event delivery setup remains available for retry") }
        }.start()
    }
    // Internal Rust service calls only; no public JS command/permission entry.
    @Command
    fun availableHealthEventMetrics(invoke: Invoke) {
        Thread {
            runCatching { HealthEventCollector.availableMetrics(activity.applicationContext) }
                .onSuccess(invoke::resolveObject).onFailure { invoke.reject(it.message) }
        }.start()
    }

    @Command
    fun configureHealthEvents(invoke: Invoke) {
        val args = parseArgs(invoke, HealthEventConfigurationArgs::class.java) ?: return
        Thread {
            runCatching {
                if (args.metrics.isNotEmpty()) {
                    val requested = HealthEventCollector.requiredPermissions(args.metrics)
                    check(args.metrics.all { it in HealthEventCollector.availableMetrics(activity.applicationContext) }) { "Background health reads are unavailable" }
                    val granted = runBlocking { HealthConnectClient.getOrCreate(activity).permissionController.getGrantedPermissions() }
                    if (!granted.containsAll(requested)) {
                        check(args.authorize) { "Background health permission was not granted" }
                        mainHandler.post {
                            runCatching {
                                val contract = PermissionController.createRequestPermissionResultContract(HEALTH_PROVIDER_PACKAGE)
                                startActivityForResult(invoke, contract.createIntent(activity, requested - granted), "onHealthEventPermissionResult")
                            }.onFailure { invoke.reject("Unable to request background health access: ${it.message}") }
                        }
                        return@runCatching null
                    }
                }
                runBlocking { HealthEventCollector.configure(activity.applicationContext, args) }
            }.onSuccess { metrics -> if (metrics != null) invoke.resolveObject(metrics) }
                .onFailure { invoke.reject("Unable to configure health events: ${it.message}") }
        }.start()
    }

    @ActivityCallback
    private fun onHealthEventPermissionResult(invoke: Invoke, result: ActivityResult) {
        val args = parseArgs(invoke, HealthEventConfigurationArgs::class.java) ?: return
        Thread {
            // Query the actual permission controller again. A sheet result is
            // not a receipt for permissions that were never granted.
            runCatching { runBlocking { HealthEventCollector.configure(activity.applicationContext, args) } }
                .onSuccess(invoke::resolveObject).onFailure { invoke.reject("Background health access was not configured: ${it.message}") }
        }.start()
    }

    @Command
    fun pendingHealthEvents(invoke: Invoke) {
        Thread {
            runCatching { runBlocking { HealthEventCollector.pending(activity.applicationContext) } }
                .onSuccess(invoke::resolveObject).onFailure { invoke.reject(it.message) }
        }.start()
    }

    @Command
    fun acknowledgeHealthEvents(invoke: Invoke) {
        val args = parseArgs(invoke, HealthEventAcknowledgementArgs::class.java) ?: return
        Thread {
            runCatching { runBlocking { HealthEventCollector.acknowledge(activity.applicationContext, args.ids) } }
                .onSuccess { invoke.resolve() }.onFailure { invoke.reject(it.message) }
        }.start()
    }

    private val calendarWrites = CalendarWrites(activity)
    private val contacts = ContactsAccess(activity)
    @Command
    fun listContacts(invoke: Invoke) { contacts.list(invoke) }
    private val photos = PhotoLibrary(activity)
    @Command
    fun listPhotos(invoke: Invoke) { photos.list(invoke) }
    @Command
    fun readPhoto(invoke: Invoke) { photos.read(invoke) }
    @Command
    fun prepareImageAttachment(invoke: Invoke) { ImageAttachmentPreparer.run(invoke) }
    private val bluetooth = BluetoothDiscovery(activity)
    private val bluetoothGattAccess = BluetoothGattAccess(activity)

    @Command
    fun bluetoothGatt(invoke: Invoke) {
        activity.runOnUiThread { bluetoothGattAccess.run(invoke) }
    }

    @Command
    fun scanBluetooth(invoke: Invoke) {
        activity.runOnUiThread { bluetooth.scan(invoke) }
    }
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
        Thread {
            runCatching { permissionPayload() }
                .onSuccess(invoke::resolve)
                .onFailure { error -> invoke.reject("Unable to check mobile permissions: ${error.message}") }
        }.start()
    }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        val request = runCatching { invoke.parseArgs(PermissionRequestArgs::class.java) }
            .getOrElse { error ->
                invoke.reject("Invalid permission request: ${error.message}")
                return
            }
        if (request.permissions?.contains(ALIAS_HEALTH) == true) {
            if (request.permissions?.size != 1) {
                invoke.reject("Health Connect access must be requested separately")
                return
            }
            requestHealthPermissions(invoke)
            return
        }
        if (request.permissions?.contains(ALIAS_NOTIFICATIONS) == true &&
            (Build.VERSION.SDK_INT < 33 || getPermissionState(ALIAS_NOTIFICATIONS) == PermissionState.GRANTED)) {
            checkPermissions(invoke)
            return
        }
        super.requestPermissions(invoke)
    }

    @Command
    fun postResultNotification(invoke: Invoke) {
        runCatching { ResultNotifications.post(activity, invoke, getPermissionState(ALIAS_NOTIFICATIONS)) }
            .onFailure { invoke.reject("Invalid result notification: ${it.message}") }
    }

    @Command
    fun removeResultNotification(invoke: Invoke) {
        runCatching { ResultNotifications.remove(activity, invoke) }
            .onFailure { invoke.reject("Unable to withdraw result notification: ${it.message}") }
    }

    @Command
    fun readClipboard(invoke: Invoke) {
        activity.runOnUiThread {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(activity)?.toString() ?: ""
            invoke.resolve(JSObject().apply { put("text", text) })
        }
    }

    @Command
    fun writeClipboard(invoke: Invoke) {
        val args = invoke.parseArgs(ClipboardArgs::class.java)
        activity.runOnUiThread {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("Xgent", args.text))
            invoke.resolve(JSObject().apply { put("text", args.text) })
        }
    }

    @Command
    fun openSettings(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", activity.packageName, null)))
                invoke.resolve(JSObject().apply { put("presented", true); put("detail", "System settings opened") })
            } catch (error: Exception) { invoke.reject(error.message ?: "Could not open system settings") }
        }
    }

    @Command
    fun status(invoke: Invoke) {
        val photoAlias = if (Build.VERSION.SDK_INT >= 34) ALIAS_PHOTOS_SELECTED else if (Build.VERSION.SDK_INT >= 33) ALIAS_PHOTOS else ALIAS_PHOTOS_LEGACY
        val connectivity = activity.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
        val transport = when {
            capabilities == null -> "none"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
        val audioOutputs = runCatching {
            val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            JSONArray().apply {
                audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).forEach { device ->
                    val outputTransport = when (device.type) {
                        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
                        AudioDeviceInfo.TYPE_REMOTE_SUBMIX -> "remote"
                        AudioDeviceInfo.TYPE_HDMI -> "hdmi"
                        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                        AudioDeviceInfo.TYPE_WIRED_HEADSET,
                        AudioDeviceInfo.TYPE_USB_HEADSET -> "wired"
                        else -> null
                    }
                    if (outputTransport != null) {
                        put(JSObject().apply {
                            put("id", device.id.toString())
                            put("name", device.productName.toString())
                            put("transport", outputTransport)
                        })
                    }
                }
            }
        }.getOrDefault(JSONArray())
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
                put("healthAvailable", healthSdkStatus() == HealthConnectClient.SDK_AVAILABLE)
                put("homeAvailable", false)
                put("network", JSObject().apply {
                    put("transport", transport)
                    put("connected", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
                    put("validated", capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
                    put("metered", connectivity.isActiveNetworkMetered)
                })
                put("audioOutputs", audioOutputs)
                put(
                    "permissionAliases",
                    JSObject().apply {
                        put("microphone", ALIAS_MICROPHONE)
                        put("notifications", ALIAS_NOTIFICATIONS)
                        put("bluetooth", if (Build.VERSION.SDK_INT >= 31) ALIAS_BLUETOOTH else ALIAS_LOCATION)
                        put("camera", ALIAS_CAMERA)
                        put("calendar", ALIAS_CALENDAR)
                        put("contacts", ALIAS_CONTACTS)
                        put("reminders", ALIAS_CALENDAR)
                        put("photos", photoAlias)
                        put("location", ALIAS_LOCATION)
                        if (healthSdkStatus() == HealthConnectClient.SDK_AVAILABLE) {
                            put("health", ALIAS_HEALTH)
                        }
                    },
                )
                put(
                    "detail",
                    healthStatusDetail(),
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
    fun readHealthSteps(invoke: Invoke) {
        val args = parseArgs(invoke, HealthStepsArgs::class.java) ?: return
        if (args.endMs <= args.startMs) {
            invoke.reject("Health range end must be after start")
            return
        }
        if (healthSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            invoke.reject(healthStatusDetail())
            return
        }
        Thread {
            runCatching {
                runBlocking {
                    val client = HealthConnectClient.getOrCreate(activity)
                    val granted = client.permissionController.getGrantedPermissions()
                    if (!granted.containsAll(HEALTH_PERMISSIONS)) {
                        throw IllegalStateException("Health Connect step permission is required")
                    }
                    val response = client.aggregate(
                        AggregateRequest(
                            metrics = setOf(StepsRecord.COUNT_TOTAL),
                            timeRangeFilter = TimeRangeFilter.between(
                                Instant.ofEpochMilli(args.startMs),
                                Instant.ofEpochMilli(args.endMs),
                            ),
                        ),
                    )
                    JSObject().apply {
                        put("startMs", args.startMs)
                        put("endMs", args.endMs)
                        put("steps", response[StepsRecord.COUNT_TOTAL] ?: 0L)
                        put("source", "health-connect")
                        put("accessLimited", false)
                    }
                }
            }.onSuccess(invoke::resolve).onFailure { error ->
                invoke.reject("Unable to read Health Connect steps: ${error.message}")
            }
        }.start()
    }

    @Command
    fun requestHealthMetricPermission(invoke: Invoke) {
        val args = parseArgs(invoke, HealthMetricArgs::class.java) ?: return
        if (healthSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            invoke.reject(healthStatusDetail())
            return
        }
        val permission = runCatching { healthMetricPermission(args.metric) }.getOrElse {
            invoke.reject(it.message ?: "Unsupported health metric")
            return
        }
        Thread {
            runCatching {
                runBlocking {
                    HealthConnectClient.getOrCreate(activity).permissionController.getGrantedPermissions()
                }
            }.onSuccess { granted ->
                if (granted.contains(permission)) {
                    invoke.resolve(JSObject().apply { put("health", "granted") })
                } else {
                    mainHandler.post {
                        runCatching {
                            val contract = PermissionController.createRequestPermissionResultContract(HEALTH_PROVIDER_PACKAGE)
                            startActivityForResult(invoke, contract.createIntent(activity, setOf(permission)), "onHealthMetricPermissionResult")
                        }.onFailure { invoke.reject("Unable to request health permission: ${it.message}") }
                    }
                }
            }.onFailure { invoke.reject("Unable to check health permission: ${it.message}") }
        }.start()
    }

    @Command
    fun listHomeInventory(invoke: Invoke) {
        invoke.reject("HomeKit inventory requires the authorized initiating iOS device; Android has no HomeKit adapter")
    }

    @ActivityCallback
    private fun onHealthMetricPermissionResult(invoke: Invoke, result: ActivityResult) {
        val args = parseArgs(invoke, HealthMetricArgs::class.java) ?: return
        val contract = PermissionController.createRequestPermissionResultContract(HEALTH_PROVIDER_PACKAGE)
        val granted = contract.parseResult(result.resultCode, result.data)
        invoke.resolve(JSObject().apply {
            put("health", if (granted.contains(healthMetricPermission(args.metric))) "granted" else "denied")
        })
    }

    @Command
    fun readHealthSamples(invoke: Invoke) {
        val args = parseArgs(invoke, HealthSamplesArgs::class.java) ?: return
        if (healthSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            invoke.reject(healthStatusDetail())
            return
        }
        Thread {
            runCatching {
                runBlocking { readHealthMetricSamples(HealthConnectClient.getOrCreate(activity), args) }
            }.onSuccess(invoke::resolve).onFailure {
                invoke.reject("Unable to read Health Connect samples: ${it.message}")
            }
        }.start()
    }

    @Command
    fun checkHealthMetricPermission(invoke: Invoke) {
        val args = parseArgs(invoke, HealthMetricArgs::class.java) ?: return
        if (healthSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            invoke.reject(healthStatusDetail()); return
        }
        Thread {
            runCatching {
                val permission = healthMetricPermission(args.metric)
                val granted = runBlocking { HealthConnectClient.getOrCreate(activity).permissionController.getGrantedPermissions() }
                JSObject().apply { put("health", if (permission in granted) "granted" else "denied") }
            }.onSuccess(invoke::resolve).onFailure { invoke.reject("Unable to check health permission: ${it.message}") }
        }.start()
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
                queryCalendarInstances(args.startMs, args.endMs, args.limit, remindersOnly = false, calendarIds = args.calendarIds)
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
                    calendarIds = args.calendarIds,
                )
            }.onSuccess(invoke::resolveObject).onFailure { error ->
                invoke.reject("Unable to read Android calendar reminders: ${error.message}")
            }
        }.start()
    }

    @Command
    fun createCalendarEvent(invoke: Invoke) {
        val args = parseArgs(invoke, CreateCalendarEventArgs::class.java) ?: return
        calendarWrites.save(invoke, args.title, args.startMs, args.endMs, args.allDay,
            args.notes, args.location, null, args.calendarId, args.expectedSourceId, false)
    }

    @Command
    fun listCalendars(invoke: Invoke) { calendarWrites.list(invoke) }

    @Command
    fun createReminder(invoke: Invoke) {
        val args = parseArgs(invoke, CreateReminderArgs::class.java) ?: return
        val due = args.dueMs
        if (due == null || due > Long.MAX_VALUE - DEFAULT_REMINDER_DURATION_MS) {
            invoke.reject("Android reminders require their first due date/time"); return
        }
        calendarWrites.save(invoke, args.title, due, due + DEFAULT_REMINDER_DURATION_MS, false,
            args.notes, null, args.recurrence, args.calendarId, args.expectedSourceId, true)
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

    private fun requestHealthPermissions(invoke: Invoke) {
        if (healthSdkStatus() != HealthConnectClient.SDK_AVAILABLE) {
            invoke.reject(healthStatusDetail())
            return
        }
        Thread {
            runCatching {
                runBlocking {
                    HealthConnectClient.getOrCreate(activity)
                        .permissionController
                        .getGrantedPermissions()
                }
            }.onSuccess { granted ->
                if (granted.containsAll(HEALTH_PERMISSIONS)) {
                    resolvePermissionPayload(invoke)
                    return@onSuccess
                }
                mainHandler.post {
                    val contract = PermissionController.createRequestPermissionResultContract(
                        HEALTH_PROVIDER_PACKAGE,
                    )
                    val intent = contract.createIntent(activity, HEALTH_PERMISSIONS)
                    startActivityForResult(invoke, intent, "onHealthPermissionResult")
                }
            }.onFailure { error ->
                invoke.reject("Unable to request Health Connect permission: ${error.message}")
            }
        }.start()
    }

    @ActivityCallback
    private fun onHealthPermissionResult(invoke: Invoke, result: ActivityResult) {
        val contract = PermissionController.createRequestPermissionResultContract(
            HEALTH_PROVIDER_PACKAGE,
        )
        val granted = contract.parseResult(result.resultCode, result.data)
        invoke.resolve(permissionPayload(healthGranted = granted.containsAll(HEALTH_PERMISSIONS)))
    }

    private fun resolvePermissionPayload(invoke: Invoke) {
        Thread {
            runCatching { permissionPayload() }
                .onSuccess(invoke::resolve)
                .onFailure { error -> invoke.reject("Unable to check mobile permissions: ${error.message}") }
        }.start()
    }

    private fun permissionPayload(healthGranted: Boolean? = null): JSObject {
        val payload = JSObject()
        getPermissionStates().forEach { (alias, state) -> payload.put(alias, state.toString()) }
        payload.put(ALIAS_NOTIFICATIONS, ResultNotifications.permissionState(activity, getPermissionState(ALIAS_NOTIFICATIONS)))
        if (photos.hasAccess()) {
            payload.put(ALIAS_PHOTOS, PermissionState.GRANTED.toString())
            payload.put(ALIAS_PHOTOS_SELECTED, PermissionState.GRANTED.toString())
            payload.put(ALIAS_PHOTOS_LEGACY, PermissionState.GRANTED.toString())
        }
        if (healthSdkStatus() == HealthConnectClient.SDK_AVAILABLE) {
            val granted = healthGranted ?: runBlocking {
                HealthConnectClient.getOrCreate(activity)
                    .permissionController
                    .getGrantedPermissions()
                    .containsAll(HEALTH_PERMISSIONS)
            }
            payload.put(
                ALIAS_HEALTH,
                if (granted) PermissionState.GRANTED.toString() else PermissionState.PROMPT.toString(),
            )
        }
        return payload
    }

    private fun healthSdkStatus(): Int = HealthConnectClient.getSdkStatus(
        activity,
        HEALTH_PROVIDER_PACKAGE,
    )

    private fun healthStatusDetail(): String = when (healthSdkStatus()) {
        HealthConnectClient.SDK_AVAILABLE ->
            "Health Connect access is available; each requested health metric requires its own read permission."
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
            "Install or update Health Connect before reading health data."
        else -> "Health Connect is unavailable on this Android device."
    }

    private fun queryCalendarInstances(
        startMs: Long,
        endMs: Long,
        requestedLimit: Int,
        remindersOnly: Boolean,
        calendarIds: List<String>? = null,
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
            CalendarContract.Instances.CALENDAR_ID,
        )
        val sources = calendarWrites.readSourceIds(calendarIds)
        if (calendarIds != null) {
            check(calendarIds.isNotEmpty() && calendarIds.size <= 16 && calendarIds.distinct().size == calendarIds.size &&
                calendarIds.all { sources.containsKey(it) }) { "The selected task calendar scope is empty, invalid or unavailable" }
        }
        val clauses = mutableListOf<String>()
        if (remindersOnly) clauses.add("${CalendarContract.Instances.HAS_ALARM}=1")
        if (calendarIds != null) clauses.add("${CalendarContract.Instances.CALENDAR_ID} IN (${calendarIds.joinToString(",") { "?" }})")
        val selection = clauses.takeIf { it.isNotEmpty() }?.joinToString(" AND ")
        val result = JSONArray()
        val records = activity.contentResolver.query(
            uriBuilder.build(),
            projection,
            selection,
            calendarIds?.toTypedArray(),
            "${CalendarContract.Instances.BEGIN} ASC",
        ) ?: error("Calendar provider did not return event records")
        records.use { cursor ->
            val limit = requestedLimit.coerceIn(1, 200)
            while (cursor.moveToNext() && result.length() < limit) {
                val payload = JSObject()
                val eventId = cursor.getString(0).orEmpty()
                val title = cursor.getString(1)?.takeIf(String::isNotBlank) ?: "Untitled event"
                val begin = cursor.getLong(2)
                val calendarId = cursor.getString(9).orEmpty()
                payload.put("calendarId", calendarId)
                payload.put("sourceId", sources[calendarId] ?: "")
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

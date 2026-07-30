package com.ohi.xagent.mobileassistant

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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

private const val ALIAS_MICROPHONE = "microphone"
private const val ALIAS_CALENDAR = "calendar"
private const val ALIAS_LOCATION = "location"
private const val ALIAS_PHOTOS = "photos"
private const val ALIAS_PHOTOS_LEGACY = "photosLegacy"

@InvokeArg
class VoiceInputArgs {
    var locale: String? = null
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = ALIAS_MICROPHONE),
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
    }

    companion object {
        private const val VOICE_TIMEOUT_MS = 30_000L
    }
}

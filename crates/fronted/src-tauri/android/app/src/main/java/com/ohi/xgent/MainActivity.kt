package com.ohi.xgent

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Process
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.WebChromeClient
import android.util.Log
import android.view.View
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.ohi.xgent.browserautomation.BrowserInteractionHost
import java.util.Locale

class MainActivity : TauriActivity(), BrowserInteractionHost {
  private data class PendingBrowserFile(
    val sessionId: String,
    val multiple: Boolean,
    val callback: ValueCallback<Array<Uri>>,
  )

  private data class PendingBrowserMedia(
    val sessionId: String,
    val permissions: Array<String>,
    val completion: (Boolean) -> Unit,
  )

  private var pendingBrowserFile: PendingBrowserFile? = null
  private var awaitingBrowserFileResult = false
  private var pendingBrowserMedia: PendingBrowserMedia? = null
  private var browserMediaDialog: AlertDialog? = null
  private var awaitingBrowserMediaResult = false

  // Register before STARTED, as required by the Activity Result API.
  private val browserFilePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val pending = pendingBrowserFile
    pendingBrowserFile = null
    awaitingBrowserFileResult = false
    if (pending != null) {
      pending.callback.onReceiveValue(
        if (result.resultCode == Activity.RESULT_OK) validatedBrowserFiles(result.data, pending.multiple) else null
      )
    }
  }
  private val browserMediaPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
    awaitingBrowserMediaResult = false
    val pending = pendingBrowserMedia ?: return@registerForActivityResult
    finishBrowserMedia(pending.permissions.all { granted[it] == true })
  }

  override fun openBrowserFileChooser(
    sessionId: String,
    params: WebChromeClient.FileChooserParams,
    callback: ValueCallback<Array<Uri>>,
  ) {
    if (awaitingBrowserFileResult || isFinishing || isDestroyed ||
      params.mode !in listOf(WebChromeClient.FileChooserParams.MODE_OPEN, WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
    ) {
      callback.onReceiveValue(null)
      return
    }
    val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
    val types = params.acceptTypes.orEmpty().flatMap { it.split(',') }.mapNotNull { raw ->
      val hint = raw.trim().lowercase(Locale.ROOT)
      val type = if (hint.startsWith('.')) {
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(hint.removePrefix("."))
      } else hint
      type?.takeIf { it.matches(Regex("[a-z0-9!#$&^_.+-]+/([a-z0-9!#$&^_.+-]+|\\*)")) }
    }.distinct().ifEmpty { listOf("*/*") }
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = if (types.size == 1) types.single() else "*/*"
      if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    pendingBrowserFile = PendingBrowserFile(sessionId, multiple, callback)
    awaitingBrowserFileResult = true
    runCatching { browserFilePicker.launch(intent) }.onFailure {
      awaitingBrowserFileResult = false
      pendingBrowserFile = null
      callback.onReceiveValue(null)
    }
  }

  override fun cancelBrowserFileChooser(sessionId: String) {
    val pending = pendingBrowserFile ?: return
    if (pending.sessionId != sessionId) return
    pendingBrowserFile = null
    pending.callback.onReceiveValue(null)
  }

  private fun validatedBrowserFiles(data: Intent?, multiple: Boolean): Array<Uri>? {
    if (data == null || data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) return null
    val clip = data.clipData
    if ((clip?.itemCount ?: 0) > 100) return null
    val uris = buildList {
      data.data?.let(::add)
      if (clip != null) for (index in 0 until clip.itemCount) {
        add(clip.getItemAt(index).uri ?: return null)
      }
    }.distinct()
    if (uris.isEmpty() || uris.size > 100 || (!multiple && uris.size != 1)) return null
    for (uri in uris) {
      if (uri.scheme != "content" || uri.authority.isNullOrBlank()) return null
      val provider = packageManager.resolveContentProvider(uri.authority!!, 0) ?: return null
      if (provider.applicationInfo.uid == applicationInfo.uid) return null
      if (checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) !=
        PackageManager.PERMISSION_GRANTED) return null
    }
    return uris.toTypedArray()
  }

  override fun requestBrowserMedia(
    sessionId: String,
    origin: String,
    permissions: Array<String>,
    completion: (Boolean) -> Unit,
  ) {
    if (isFinishing || isDestroyed || awaitingBrowserMediaResult || permissions.isEmpty() || permissions.any {
      it != Manifest.permission.RECORD_AUDIO && it != Manifest.permission.CAMERA
    }) {
      completion(false)
      return
    }
    val previous = pendingBrowserMedia
    pendingBrowserMedia = null
    browserMediaDialog?.dismiss()
    browserMediaDialog = null
    previous?.completion?.invoke(false)
    pendingBrowserMedia = PendingBrowserMedia(sessionId, permissions, completion)
    val description = permissions.joinToString(" and ") {
      if (it == Manifest.permission.CAMERA) "camera" else "microphone"
    }
    browserMediaDialog = AlertDialog.Builder(this)
      .setTitle("Website permission")
      .setMessage("Allow ${Uri.parse(origin).host ?: origin} to use $description in this browser tab?")
      .setNegativeButton(android.R.string.cancel) { _, _ -> finishBrowserMedia(false) }
      .setPositiveButton(android.R.string.ok) { _, _ ->
        browserMediaDialog = null
        if (permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) {
          finishBrowserMedia(true)
        } else {
          awaitingBrowserMediaResult = true
          runCatching { browserMediaPermissions.launch(permissions) }.onFailure {
            awaitingBrowserMediaResult = false
            finishBrowserMedia(false)
          }
        }
      }
      .setOnCancelListener { finishBrowserMedia(false) }
      .show()
  }

  override fun cancelBrowserMedia(sessionId: String) {
    val pending = pendingBrowserMedia ?: return
    if (pending.sessionId != sessionId) return
    pendingBrowserMedia = null
    browserMediaDialog?.dismiss()
    browserMediaDialog = null
  }

  private fun finishBrowserMedia(granted: Boolean) {
    val pending = pendingBrowserMedia ?: return
    pendingBrowserMedia = null
    browserMediaDialog?.dismiss()
    browserMediaDialog = null
    pending.completion(granted && !isFinishing && !isDestroyed &&
      pending.permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED })
  }

  override fun onDestroy() {
    pendingBrowserFile?.callback?.onReceiveValue(null)
    pendingBrowserFile = null
    pendingBrowserMedia?.completion?.invoke(false)
    pendingBrowserMedia = null
    browserMediaDialog?.dismiss()
    browserMediaDialog = null
    super.onDestroy()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.rgb(247, 247, 245)))
    super.onCreate(savedInstanceState)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    // WebView <139 does not resize its visual viewport for edge-to-edge IME.
    // Resize the native content instead, and zero handled insets so newer
    // WebViews do not subtract the keyboard or safe areas a second time.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val types = WindowInsetsCompat.Type.ime() or WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout()
      val insets = windowInsets.getInsets(types)
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      view.post {
        val position = IntArray(2)
        view.getLocationOnScreen(position)
        Log.i("XgentViewport", "ime=${windowInsets.isVisible(WindowInsetsCompat.Type.ime())} visibleBottom=${position[1] + view.height - insets.bottom}")
      }
      WindowInsetsCompat.Builder(windowInsets).setInsets(types, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
    Log.i("XgentStartup", "Activity created")
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // Register after Tauri's plugin callbacks. Claim an in-app destination in
    // JavaScript first; at the chat root Tauri retains its native back behavior.
    webView.post {
      if (!isFinishing && !isDestroyed) {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
          private var pending = false
          override fun handleOnBackPressed() {
            if (pending) return
            pending = true
            webView.evaluateJavascript("""
              !window.dispatchEvent(new Event('xgent:mobile-back', {cancelable: true}))
            """.trimIndent()) { handled ->
              pending = false
              if (handled != "true" && !isFinishing && !isDestroyed) {
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
              }
            }
          }
        })
      }
    }
    webView.setBackgroundColor(android.graphics.Color.rgb(247, 247, 245))
    Log.i("XgentStartup", "WebView created: ${WebView.getCurrentWebViewPackage()?.versionName}")
    // Bounded startup diagnostics: readiness/geometry only, never chat content.
    // A live process with an empty or hidden WebView is not a successful launch.
    for (delay in listOf(1000L, 5000L, 15000L, 30000L)) {
      webView.postDelayed({
        if (!isFinishing && !isDestroyed) {
          Log.i("XgentStartup", "WebView ${webView.width}x${webView.height}, shown=${webView.isShown}, progress=${webView.progress}")
          webView.evaluateJavascript("""
            JSON.stringify({ready: document.readyState, root: !!document.getElementById('root'),
              children: document.getElementById('root')?.childElementCount ?? 0,
              interactive: !document.getElementById('root')?.hasAttribute('inert'),
              controls: document.querySelectorAll('textarea,[contenteditable=true],button').length,
              tauri: !!window.__TAURI_INTERNALS__})
          """.trimIndent()) { state -> Log.i("XgentStartup", "DOM $state") }
        }
      }, delay)
    }

    // Xgent owns both light and dark palettes in CSS. Android WebView's
    // algorithmic darkening mutates those colors a second time, which can turn
    // surfaces black or red while leaving their text unreadable.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
      WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
    }
  }
}

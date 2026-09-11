package com.ohi.xgent

import android.os.Bundle
import android.webkit.WebView
import android.util.Log
import android.view.View
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
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

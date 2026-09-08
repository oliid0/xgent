package com.ohi.xgent

import android.os.Bundle
import android.webkit.WebView
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    Log.i("XgentStartup", "Activity created")
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
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
              launch: !!document.getElementById('launch-screen'),
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

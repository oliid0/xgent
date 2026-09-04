package com.ohi.xgent.browserautomation

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt
import org.json.JSONObject
import org.json.JSONArray
import org.json.JSONTokener

@InvokeArg
class BrowserViewportArgs {
    var x: Double? = null
    var y: Double? = null
    var width: Double? = null
    var height: Double? = null
    var visible: Boolean? = null
    var scaleFactor: Double? = null
}

@InvokeArg
class OpenSessionArgs {
    var sessionId: String? = null
    var url: String? = null
    var viewport: BrowserViewportArgs? = null
    var userAgent: String? = null
    var runtimeScript: String? = null
}

@InvokeArg
class SessionArgs {
    var sessionId: String? = null
}

@InvokeArg
class SetViewportArgs {
    var sessionId: String? = null
    var viewport: BrowserViewportArgs? = null
}

@InvokeArg
class BrowserActionInputArgs {
    var url: String? = null
    var ref: String? = null
    var selector: String? = null
    var text: String? = null
    var key: String? = null
    var script: String? = null
    var direction: String? = null
    var amount: Double? = null
    var x: Double? = null
    var y: Double? = null
    var limit: Double? = null
    var maxDepth: Double? = null
    var maxNodes: Double? = null
    var smooth: Boolean? = null
    var submit: Boolean? = null

    fun toJson(): JSONObject = JSONObject().apply {
        url?.let { put("url", it) }
        ref?.let { put("ref", it) }
        selector?.let { put("selector", it) }
        text?.let { put("text", it) }
        key?.let { put("key", it) }
        script?.let { put("script", it) }
        direction?.let { put("direction", it) }
        amount?.let { put("amount", it) }
        x?.let { put("x", it) }
        y?.let { put("y", it) }
        limit?.let { put("limit", it) }
        maxDepth?.let { put("maxDepth", it) }
        maxNodes?.let { put("maxNodes", it) }
        smooth?.let { put("smooth", it) }
        submit?.let { put("submit", it) }
    }
}

@InvokeArg
class ActionArgs {
    var requestId: String? = null
    var sessionId: String? = null
    var action: String? = null
    var input: BrowserActionInputArgs? = null
    var timeoutMs: Long? = null
    var runtimeScript: String? = null
}

private data class BrowserSession(
    val sessionId: String,
    var webView: WebView,
    var runtimeScript: String,
    var userAgent: String? = null,
    var lastUrl: String = "",
    var viewport: BrowserViewportArgs = BrowserViewportArgs(),
    var title: String? = null,
    var loading: Boolean = false,
    var documentReady: Boolean = false,
    var visible: Boolean = false,
    var pendingNavigation: PendingBrowserNavigation? = null,
)

private data class PendingBrowserNavigation(
    val action: String,
    val gate: BrowserInvocationGate,
    val requestId: String,
    val requestedUrl: String? = null,
    val recovered: Boolean = false,
    var generation: Long = 0,
)

private class BrowserInvocationGate(
    private val invoke: Invoke,
    timeoutMs: Long,
    private val onTimeout: (() -> Unit)? = null,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var completed = false
    private val normalizedTimeout = timeoutMs.coerceIn(500L, 30_000L)
    private val timeout = Runnable {
        onTimeout?.invoke()
        reject("Browser action timed out after $normalizedTimeout ms")
    }

    init {
        handler.postDelayed(timeout, normalizedTimeout)
    }

    fun resolve(payload: JSObject) {
        if (completed) return
        completed = true
        handler.removeCallbacks(timeout)
        invoke.resolve(payload)
    }

    fun reject(message: String) {
        if (completed) return
        completed = true
        handler.removeCallbacks(timeout)
        invoke.reject(message)
    }

    fun isCompleted(): Boolean = completed
}

@TauriPlugin
class BrowserAutomationPlugin(private val activity: Activity) : Plugin(activity) {
    private val sessions = linkedMapOf<String, BrowserSession>()
    private var navigationGeneration = 0L

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(
            JSObject().apply {
                put("backend", "android-webview")
                put("available", true)
                put("detail", "Android System WebView sessions in Xgent's app-owned browser profile")
                put(
                    "capabilities",
                    JSObject().apply {
                        put("visibleSessions", true)
                        put("domAutomation", true)
                        put("javascript", true)
                        put("screenshots", true)
                        put("downloads", false)
                        put("multipleSessions", true)
                    },
                )
            },
        )
    }

    @Command
    fun openSession(invoke: Invoke) {
        val args = parse(invoke, OpenSessionArgs::class.java) ?: return
        val sessionId = validateSessionId(invoke, args.sessionId) ?: return
        val url = validateUrl(invoke, args.url) ?: return
        val runtimeScript = args.runtimeScript?.takeIf { it.isNotBlank() }
        if (runtimeScript == null) {
            invoke.reject("The browser runtime script is missing")
            return
        }

        activity.runOnUiThread {
            runCatching {
                val existing = sessions[sessionId]
                if (existing != null) {
                    existing.runtimeScript = runtimeScript
                    existing.userAgent = args.userAgent
                    existing.lastUrl = url
                    args.userAgent
                        ?.takeIf { it.isNotBlank() }
                        ?.let { existing.webView.settings.userAgentString = it }
                    applyViewport(existing, args.viewport)
                    existing.loading = true
                    existing.documentReady = false
                    existing.webView.loadUrl(url)
                    invoke.resolve(summary(existing))
                    return@runOnUiThread
                }

                val webView = WebView(activity)
                val session = BrowserSession(
                    sessionId = sessionId,
                    webView = webView,
                    runtimeScript = runtimeScript,
                    userAgent = args.userAgent,
                    lastUrl = url,
                )
                configureWebView(session, args.userAgent)
                contentRoot().addView(webView)
                sessions[sessionId] = session
                applyViewport(session, args.viewport)
                session.loading = true
                session.documentReady = false
                webView.loadUrl(url)
                invoke.resolve(summary(session))
            }.onFailure { error ->
                invoke.reject("Failed to create browser session: ${error.message}")
            }
        }
    }

    @Command
    fun listSessions(invoke: Invoke) {
        activity.runOnUiThread {
            val payload = JSONArray()
            sessions.values.forEach { payload.put(summary(it)) }
            invoke.resolveObject(payload)
        }
    }

    @Command
    fun closeSession(invoke: Invoke) {
        val args = parse(invoke, SessionArgs::class.java) ?: return
        val sessionId = validateSessionId(invoke, args.sessionId) ?: return
        activity.runOnUiThread {
            val session = sessions.remove(sessionId)
            if (session == null) {
                invoke.reject("Browser session was not found")
                return@runOnUiThread
            }
            session.pendingNavigation?.gate?.reject("Browser tab was closed during navigation")
            session.pendingNavigation = null
            val payload = summary(session)
            (session.webView.parent as? ViewGroup)?.removeView(session.webView)
            session.webView.stopLoading()
            session.webView.loadUrl("about:blank")
            session.webView.destroy()
            invoke.resolve(payload)
        }
    }

    @Command
    fun setViewport(invoke: Invoke) {
        val args = parse(invoke, SetViewportArgs::class.java) ?: return
        val sessionId = validateSessionId(invoke, args.sessionId) ?: return
        activity.runOnUiThread {
            val session = sessions[sessionId]
            if (session == null) {
                invoke.reject("Browser session was not found")
                return@runOnUiThread
            }
            applyViewport(session, args.viewport)
            invoke.resolve(summary(session))
        }
    }

    @Command
    fun action(invoke: Invoke) {
        val args = parse(invoke, ActionArgs::class.java) ?: return
        val requestId = validateRequestId(invoke, args.requestId) ?: return
        val sessionId = validateSessionId(invoke, args.sessionId) ?: return
        val action = args.action?.trim()?.lowercase(Locale.US).orEmpty()
        if (action.isBlank()) {
            invoke.reject("Browser action is required")
            return
        }

        activity.runOnUiThread {
            val session = sessions[sessionId]
            if (session == null) {
                invoke.reject("Browser session was not found")
                return@runOnUiThread
            }
            args.runtimeScript?.takeIf { it.isNotBlank() }?.let { session.runtimeScript = it }
            executeAction(
                invoke,
                session,
                requestId,
                action,
                args.input ?: BrowserActionInputArgs(),
                args.timeoutMs ?: 30_000L,
            )
        }
    }

    private fun configureWebView(session: BrowserSession, userAgent: String?) {
        val webView = session.webView
        webView.setBackgroundColor(android.graphics.Color.WHITE)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            userAgent?.takeIf { it.isNotBlank() }?.let { userAgentString = it }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView?, title: String?) {
                session.title = title
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val scheme = request?.url?.scheme?.lowercase(Locale.US)
                return scheme != "http" && scheme != "https"
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                session.loading = true
                session.documentReady = false
                url?.let { session.lastUrl = it }
                session.pendingNavigation?.let { pending ->
                    navigationGeneration = navigationGeneration.inc()
                    pending.generation = navigationGeneration
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                url?.let { session.lastUrl = it }
                val generation = session.pendingNavigation?.generation
                val loadedView = view ?: return finishRenderedPage(session, null, generation)
                if (url != null && loadedView.url != null && url != loadedView.url) return
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    loadedView.postVisualStateCallback(
                        System.nanoTime(),
                        object : WebView.VisualStateCallback() {
                            override fun onComplete(requestId: Long) {
                                if (session.webView === loadedView) {
                                    finishRenderedPage(session, loadedView, generation)
                                }
                            }
                        },
                    )
                } else {
                    finishRenderedPage(session, loadedView, generation)
                }
            }

            override fun onPageCommitVisible(view: WebView?, url: String?) {
                val committedView = view ?: return
                if (session.webView !== committedView) return
                url?.let { session.lastUrl = it }
                session.documentReady = true
                committedView.evaluateJavascript(session.runtimeScript, null)
                completeNavigation(session, session.pendingNavigation?.generation)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame != true) return
                session.loading = false
                failNavigation(
                    session,
                    "Browser navigation failed: ${error?.description ?: "unknown WebView error"}",
                )
            }

            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?,
            ): Boolean {
                val failedView = view ?: return false
                if (session.webView !== failedView) return true
                recoverAndroidRenderer(session, failedView, detail?.didCrash() == true)
                return true
            }
        }
    }

    private fun finishRenderedPage(
        session: BrowserSession,
        view: WebView?,
        generation: Long?,
    ) {
        session.loading = false
        session.documentReady = true
        session.title = view?.title
        view?.evaluateJavascript(session.runtimeScript, null)
        completeNavigation(session, generation)
    }

    private fun recoverAndroidRenderer(
        session: BrowserSession,
        failedView: WebView,
        crashed: Boolean,
    ) {
        session.loading = false
        failNavigation(
            session,
            if (crashed) {
                "Browser renderer crashed and was recreated"
            } else {
                "Browser renderer was terminated and was recreated"
            },
        )
        val root = contentRoot()
        root.removeView(failedView)
        failedView.destroy()

        val replacement = WebView(activity)
        session.webView = replacement
        session.documentReady = false
        configureWebView(session, session.userAgent)
        root.addView(replacement)
        applyViewport(session, session.viewport)
        session.lastUrl.takeIf { it.startsWith("http://") || it.startsWith("https://") }?.let {
            session.loading = true
            replacement.loadUrl(it)
        }
    }

    private fun executeAction(
        invoke: Invoke,
        session: BrowserSession,
        requestId: String,
        action: String,
        input: BrowserActionInputArgs,
        timeoutMs: Long,
    ) {
        val webView = session.webView
        when (action) {
            "navigate" -> {
                val url = validateUrl(invoke, input.url) ?: return
                beginNavigation(invoke, session, requestId, action, url, timeoutMs) {
                    webView.loadUrl(url)
                }
            }
            "reload" -> {
                beginNavigation(invoke, session, requestId, action, webView.url, timeoutMs) {
                    webView.reload()
                }
            }
            "go_back" -> {
                if (!webView.canGoBack()) {
                    invoke.resolve(
                        actionResponse(
                            session,
                            requestId,
                            action,
                            JSONObject().put("navigated", false),
                        ),
                    )
                } else {
                    beginNavigation(invoke, session, requestId, action, null, timeoutMs) {
                        webView.goBack()
                    }
                }
            }
            "go_forward" -> {
                if (!webView.canGoForward()) {
                    invoke.resolve(
                        actionResponse(
                            session,
                            requestId,
                            action,
                            JSONObject().put("navigated", false),
                        ),
                    )
                } else {
                    beginNavigation(invoke, session, requestId, action, null, timeoutMs) {
                        webView.goForward()
                    }
                }
            }
            "recover" -> {
                webView.stopLoading()
                beginNavigation(
                    invoke,
                    session,
                    requestId,
                    action,
                    webView.url ?: session.lastUrl,
                    timeoutMs.coerceAtMost(10_000L),
                    recovered = true,
                ) { webView.reload() }
            }
            "screenshot" -> captureScreenshot(invoke, session, requestId, action, timeoutMs)
            else -> evaluateDomAction(
                invoke,
                session,
                requestId,
                action,
                input.toJson(),
                timeoutMs,
            )
        }
    }

    private fun beginNavigation(
        invoke: Invoke,
        session: BrowserSession,
        requestId: String,
        action: String,
        requestedUrl: String?,
        timeoutMs: Long,
        recovered: Boolean = false,
        start: () -> Unit,
    ) {
        session.pendingNavigation?.gate?.reject("Browser navigation was superseded by a new action")
        lateinit var pending: PendingBrowserNavigation
        val gate = BrowserInvocationGate(invoke, timeoutMs) {
            if (session.pendingNavigation === pending) {
                session.pendingNavigation = null
                session.loading = false
            }
        }
        pending = PendingBrowserNavigation(action, gate, requestId, requestedUrl, recovered)
        session.pendingNavigation = pending
        session.loading = true
        session.documentReady = false
        requestedUrl?.let { session.lastUrl = it }
        runCatching(start).onFailure { error ->
            if (session.pendingNavigation === pending) session.pendingNavigation = null
            session.loading = false
            gate.reject("Browser navigation failed: ${error.message}")
        }
    }

    private fun completeNavigation(session: BrowserSession, generation: Long?) {
        val pending = session.pendingNavigation ?: return
        if (generation == null || pending.generation == 0L || pending.generation != generation) return
        session.pendingNavigation = null
        val data = JSONObject().apply {
            put("navigated", true)
            put("readyState", "complete")
            put("url", session.webView.url ?: pending.requestedUrl ?: "")
        }
        pending.gate.resolve(
            actionResponse(
                session,
                pending.requestId,
                pending.action,
                data,
                navigationStarted = true,
                navigationFinished = true,
                recovered = pending.recovered,
            ),
        )
    }

    private fun failNavigation(session: BrowserSession, message: String) {
        val pending = session.pendingNavigation ?: return
        session.pendingNavigation = null
        pending.gate.reject(message)
    }

    private fun evaluateDomAction(
        invoke: Invoke,
        session: BrowserSession,
        requestId: String,
        action: String,
        input: JSONObject,
        timeoutMs: Long,
    ) {
        val actionWebView = session.webView
        val gate = BrowserInvocationGate(invoke, timeoutMs)
        val script = """
            (() => {
              if (!window.__xgentBrowserRuntime) {
                ${session.runtimeScript}
              }
              return window.__xgentBrowserRuntime.execute(${JSONObject.quote(action)}, ${input});
            })()
        """.trimIndent()
        evaluateDomActionWhenReady(session, actionWebView, gate, requestId, action, script)
    }

    private fun evaluateDomActionWhenReady(
        session: BrowserSession,
        actionWebView: WebView,
        gate: BrowserInvocationGate,
        requestId: String,
        action: String,
        script: String,
    ) {
        if (gate.isCompleted()) return
        if (session.webView !== actionWebView) {
            gate.reject("Browser renderer changed before the action could run")
            return
        }
        if (!session.documentReady) {
            actionWebView.postDelayed(
                {
                    evaluateDomActionWhenReady(
                        session,
                        actionWebView,
                        gate,
                        requestId,
                        action,
                        script,
                    )
                },
                50L,
            )
            return
        }
        actionWebView.evaluateJavascript(script) { encoded ->
            runCatching {
                val decoded = JSONTokener(encoded).nextValue()
                val raw = if (decoded is String) decoded else encoded
                val envelope = JSONObject(raw)
                if (!envelope.optBoolean("ok", false)) {
                    throw IllegalStateException(
                        envelope.optString("error", "Browser DOM action failed"),
                    )
                }
                gate.resolve(
                    actionResponse(
                        session,
                        requestId,
                        action,
                        envelope.opt("data") ?: JSONObject.NULL,
                    ),
                )
            }.onFailure { error ->
                gate.reject("Browser action failed: ${error.message}")
            }
        }
    }

    private fun captureScreenshot(
        invoke: Invoke,
        session: BrowserSession,
        requestId: String,
        action: String,
        timeoutMs: Long,
    ) {
        val screenshotWebView = session.webView
        val gate = BrowserInvocationGate(invoke, timeoutMs)
        val webView = screenshotWebView
        if (webView.width <= 0 || webView.height <= 0) {
            gate.reject("Browser viewport has no drawable size")
            return
        }
        runCatching {
            val bitmap = Bitmap.createBitmap(webView.width, webView.height, Bitmap.Config.ARGB_8888)
            webView.draw(Canvas(bitmap))
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            bitmap.recycle()
            val encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            actionResponse(
                session,
                requestId,
                action,
                JSONObject().apply {
                    put("width", webView.width)
                    put("height", webView.height)
                    put("mimeType", "image/png")
                },
                encoded,
            )
        }.onSuccess(gate::resolve).onFailure { error ->
            gate.reject("Browser screenshot failed: ${error.message}")
        }
    }

    private fun applyViewport(session: BrowserSession, raw: BrowserViewportArgs?) {
        val viewport = raw ?: BrowserViewportArgs()
        session.viewport = BrowserViewportArgs().also { copy ->
            copy.x = viewport.x
            copy.y = viewport.y
            copy.width = viewport.width
            copy.height = viewport.height
            copy.visible = viewport.visible
            copy.scaleFactor = viewport.scaleFactor
        }
        val scale = max(0.1, viewport.scaleFactor ?: activity.resources.displayMetrics.density.toDouble())
        val width = max(1, ((viewport.width ?: 1.0) * scale).roundToInt())
        val height = max(1, ((viewport.height ?: 1.0) * scale).roundToInt())
        val x = max(0, ((viewport.x ?: 0.0) * scale).roundToInt())
        val y = max(0, ((viewport.y ?: 0.0) * scale).roundToInt())
        val webView = session.webView
        val root = contentRoot()
        if (root is FrameLayout) {
            webView.layoutParams = FrameLayout.LayoutParams(width, height).apply {
                leftMargin = x
                topMargin = y
            }
            webView.translationX = 0f
            webView.translationY = 0f
        } else {
            webView.layoutParams = ViewGroup.LayoutParams(width, height)
            webView.translationX = x.toFloat()
            webView.translationY = y.toFloat()
        }
        session.visible = viewport.visible ?: false
        // INVISIBLE preserves layout/rendering for background DOM geometry and
        // screenshots without covering the Tauri UI. GONE collapses the
        // WebView to 0x0 and makes agent screenshots unusable.
        webView.visibility = if (session.visible) View.VISIBLE else View.INVISIBLE
        if (session.visible) webView.bringToFront()
    }

    private fun summary(session: BrowserSession): JSObject = JSObject().apply {
        put("sessionId", session.sessionId)
        put("url", session.webView.url ?: session.lastUrl)
        put("title", session.title ?: JSONObject.NULL)
        put("visible", session.visible)
        put("loading", session.loading)
    }

    private fun actionResponse(
        session: BrowserSession,
        requestId: String,
        action: String,
        data: Any,
        screenshotBase64: String? = null,
        navigationStarted: Boolean = false,
        navigationFinished: Boolean = false,
        recovered: Boolean = false,
    ): JSObject = JSObject().apply {
        put("requestId", requestId)
        put("sessionId", session.sessionId)
        put("action", action)
        put("url", session.webView.url ?: session.lastUrl)
        put("title", session.title ?: JSONObject.NULL)
        put("data", data)
        put("screenshotBase64", screenshotBase64 ?: JSONObject.NULL)
        put(
            "lifecycle",
            JSONObject().apply {
                put("commandCompleted", true)
                put("navigationStarted", navigationStarted)
                put("navigationFinished", navigationFinished)
                put("recovered", recovered)
            },
        )
    }

    private fun contentRoot(): ViewGroup =
        activity.findViewById<ViewGroup>(android.R.id.content)
            ?: throw IllegalStateException("Android content root is unavailable")

    private fun <T> parse(invoke: Invoke, type: Class<T>): T? =
        runCatching { invoke.parseArgs(type) }.getOrElse { error ->
            invoke.reject("Invalid browser request: ${error.message}")
            null
        }

    private fun validateSessionId(invoke: Invoke, raw: String?): String? {
        val sessionId = raw?.trim().orEmpty()
        val valid =
            sessionId.isNotEmpty() &&
                sessionId.length <= 64 &&
                sessionId.all {
                    (it.isLetterOrDigit() && it.code <= 0x7f) || it == '-' || it == '_'
                }
        if (!valid) {
            invoke.reject("sessionId must contain 1-64 ASCII letters, digits, '-' or '_'")
            return null
        }
        return sessionId
    }

    private fun validateRequestId(invoke: Invoke, raw: String?): String? {
        val requestId = raw?.trim().orEmpty()
        val valid =
            requestId.isNotEmpty() &&
                requestId.length <= 128 &&
                requestId.all {
                    (it.isLetterOrDigit() && it.code <= 0x7f) || it == '-' || it == '_' || it == '.'
                }
        if (!valid) {
            invoke.reject("requestId must contain 1-128 ASCII letters, digits, '-', '_' or '.'")
            return null
        }
        return requestId
    }

    private fun validateUrl(invoke: Invoke, raw: String?): String? {
        val value = raw?.trim().orEmpty()
        val normalized = if ("://" in value) value else "https://$value"
        val uri = runCatching { Uri.parse(normalized) }.getOrNull()
        if (uri == null || uri.host.isNullOrBlank() || uri.scheme !in setOf("http", "https")) {
            invoke.reject("Browser navigation only supports valid http and https URLs")
            return null
        }
        return normalized
    }
}

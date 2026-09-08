package com.ohi.xgent.mobileassistant

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID

/** Android's public accessibility API owns cross-app observation and input. */
class ComputerUseService : AccessibilityService() {
    companion object { @Volatile var instance: ComputerUseService? = null }
    private val handler = Handler(Looper.getMainLooper())
    private var busy = false
    private var activeRun = ""
    private var cancelled = false
    private var stateId = ""
    private var targetPackage = ""
    private var targetWindow = -1
    private var screenWidth = 0
    private var screenHeight = 0
    private var imageWidth = 0
    private var imageHeight = 0
    private var records = emptyList<AccessibilityNodeInfo>()

    override fun onServiceConnected() { instance = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) { }
    override fun onInterrupt() { stateId = "" }
    override fun onDestroy() { instance = null; stateId = ""; super.onDestroy() }

    private fun root(): AccessibilityNodeInfo? = windows.firstOrNull {
        it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive
    }?.root ?: rootInActiveWindow

    private fun result(text: String, error: Boolean = false): JSONObject = JSONObject()
        .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text)))
        .put("isError", error)

    fun cancel(runId: String?): Boolean {
        if (!busy || (runId != null && activeRun != runId)) return false
        cancelled = true
        stateId = ""
        return true
    }

    fun call(operation: String, args: JSONObject, runId: String, reply: (JSONObject) -> Unit) {
        if (busy) { reply(result("Computer use is busy; wait for the current observation", true)); return }
        if (!getSharedPreferences("xgent-cua", MODE_PRIVATE).getBoolean("enabled", false)) {
            reply(result("Enable Computer use in Xgent settings", true)); return
        }
        busy = true
        activeRun = runId
        cancelled = false
        var finished = false
        val finish: (JSONObject) -> Unit = { value ->
            if (!finished) {
                finished = true; busy = false
                reply(if (cancelled) result("Cancelled; an already dispatched gesture may have completed. Observe before retrying.", true) else value)
            }
        }
        val active = { !finished && !cancelled }
        handler.postDelayed({ if (!finished) finish(result("Computer-use deadline exceeded; observe before retrying", true)) }, 12000)
        try {
            if (operation == "list_apps") {
                val launchable = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                val apps = JSONArray()
                launchable.distinctBy { it.activityInfo.packageName }.filter { it.activityInfo.packageName != packageName }.forEach {
                    apps.put(JSONObject().put("app", it.loadLabel(packageManager).toString()).put("app_id", it.activityInfo.packageName))
                }
                finish(result(apps.toString())); return
            }
            val query = args.optString("app")
            require(query.isNotBlank() && query != packageName) { "Choose a target package from list_apps, other than Xgent" }
            if (operation == "launch_app" || (operation == "get_app_state" && root()?.packageName?.toString() != query)) {
                val intent = packageManager.getLaunchIntentForPackage(query) ?: error("No launchable package $query; use list_apps")
                startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                handler.postDelayed({ observe(query, args, false, active, finish) }, 700)
                return
            }
            if (operation == "get_app_state" || operation == "capture_preview") {
                observe(query, args, operation == "capture_preview", active, finish); return
            }
            val current = root() ?: error("No active application window")
            if (query != targetPackage || current.packageName?.toString() != query || current.windowId != targetWindow ||
                stateId.isEmpty() || args.optString("state_id") != stateId) {
                finish(result("ACTION NOT APPLIED: stale state or changed application. Call get_app_state.", true)); return
            }
            stateId = ""
            val node = if (args.has("element_index")) {
                records.getOrNull(args.optString("element_index").toIntOrNull() ?: -1)?.also {
                    require(it.refresh() && it.packageName?.toString() == query && it.windowId == current.windowId) { "Element changed; observe again" }
                } ?: error("Unknown element_index; observe again")
            } else null
            fun observeAfter() { handler.postDelayed({ observe(query, args, false, active, finish) }, 280) }
            fun point(x: String, y: String): Pair<Float, Float> {
                if (node != null && x == "x") {
                    val rect = Rect(); node.getBoundsInScreen(rect)
                    require(!rect.isEmpty && node.isVisibleToUser) { "Element is not visible" }
                    return rect.exactCenterX() to rect.exactCenterY()
                }
                require(imageWidth > 0 && imageHeight > 0) { "Observe a screenshot before coordinate input" }
                val px = args.getDouble(x); val py = args.getDouble(y)
                require(px.isFinite() && py.isFinite() && px >= 0 && py >= 0 && px < imageWidth && py < imageHeight) { "Coordinates are outside the screenshot" }
                return (px * screenWidth / imageWidth).toFloat() to (py * screenHeight / imageHeight).toFloat()
            }
            fun gesture(start: Pair<Float, Float>, end: Pair<Float, Float>, duration: Long, count: Int = 1) {
                val builder = GestureDescription.Builder()
                repeat(count) { index ->
                    val path = Path().apply { moveTo(start.first, start.second); if (start != end) lineTo(end.first, end.second) }
                    builder.addStroke(GestureDescription.StrokeDescription(path, index * (duration + 90), duration))
                }
                val accepted = dispatchGesture(builder.build(), object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) { observeAfter() }
                    override fun onCancelled(gestureDescription: GestureDescription?) { finish(result("Gesture cancelled; observe before retrying", true)) }
                }, handler)
                if (!accepted) finish(result("Android rejected the gesture", true))
            }
            when (operation) {
                "click" -> {
                    val count = args.optInt("click_count", 1)
                    require(count in 1..3 && args.optString("mouse_button", "left") == "left") { "Android supports one to three touch taps" }
                    if (node != null && count == 1 && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) observeAfter()
                    else { val p = point("x", "y"); gesture(p, p, 50, count) }
                }
                "drag" -> gesture(point("from_x", "from_y"), point("to_x", "to_y"), 450)
                "scroll" -> {
                    val direction = args.getString("direction")
                    require(direction in listOf("up", "down", "left", "right")) { "Invalid scroll direction" }
                    val action = if (direction == "up" || direction == "left") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    if (node != null && node.isScrollable && node.performAction(action)) observeAfter()
                    else {
                        val center = if (node != null || args.has("x")) point("x", "y") else screenWidth * .5f to screenHeight * .5f
                        val horizontal = direction == "left" || direction == "right"
                        val distance = (if (horizontal) screenWidth else screenHeight) * .3f
                        val sign = if (direction == "down" || direction == "right") 1 else -1
                        val start = if (horizontal) center.first + sign * distance to center.second else center.first to center.second + sign * distance
                        val end = if (horizontal) center.first - sign * distance to center.second else center.first to center.second - sign * distance
                        gesture(start.first.coerceIn(1f, screenWidth - 1f) to start.second.coerceIn(1f, screenHeight - 1f),
                            end.first.coerceIn(1f, screenWidth - 1f) to end.second.coerceIn(1f, screenHeight - 1f), 350)
                    }
                }
                "type_text", "set_value" -> {
                    val editor = node ?: current.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: error("Click a text field first")
                    require(editor.isEditable && editor.isEnabled) { "Target does not expose editable text" }
                    val text = if (operation == "set_value") args.getString("value") else {
                        val existing = editor.text?.toString().orEmpty()
                        val start = editor.textSelectionStart.coerceIn(0, existing.length)
                        val end = editor.textSelectionEnd.coerceIn(start, existing.length)
                        existing.substring(0, start) + args.getString("text") + existing.substring(end)
                    }
                    require(editor.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                    })) { "Application rejected text input" }
                    observeAfter()
                }
                "press_key" -> {
                    val key = args.getString("key").lowercase()
                    val editor = current.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                    val applied = when (key) {
                        "back", "escape" -> performGlobalAction(GLOBAL_ACTION_BACK)
                        "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                        "enter", "return" -> if (Build.VERSION.SDK_INT >= 30) editor?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) == true else false
                        "ctrl+a", "control+a", "meta+a" -> editor?.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
                            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
                            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, editor.text?.length ?: 0)
                        }) == true
                        else -> error("Android supports Back, Home, Enter and Control+A; use touch gestures for other controls")
                    }
                    require(applied) { "Android rejected the key action" }
                    observeAfter()
                }
                else -> error("Unsupported Android computer-use operation: $operation")
            }
        } catch (error: Exception) { finish(result(error.message ?: error.toString(), true)) }
    }

    private fun observe(query: String, args: JSONObject, preview: Boolean, active: () -> Boolean, reply: (JSONObject) -> Unit) {
        try {
            if (!active()) { reply(result("Cancelled", true)); return }
            val root = root() ?: error("No application window is available")
            require(root.packageName?.toString() == query) { "Target $query is not active; get_app_state can launch it" }
            val nodes = mutableListOf<AccessibilityNodeInfo>()
            fun walk(node: AccessibilityNodeInfo, depth: Int) {
                if (nodes.size >= 300 || depth > 24) return
                nodes.add(node)
                for (i in 0 until node.childCount) { node.getChild(i)?.let { walk(it, depth + 1) } }
            }
            if (!preview && args.optString("observation") != "image") walk(root, 0)
            fun complete(bitmap: Bitmap?, note: String = "") {
                try {
                    if (!active()) { bitmap?.recycle(); reply(result("Cancelled", true)); return }
                    val id = if (preview) "" else UUID.randomUUID().toString()
                    val text = StringBuilder("App: $query\nstate_id: $id\nCoordinates are full-screen screenshot pixels. $note")
                    nodes.forEachIndexed { index, node ->
                        val rect = Rect(); node.getBoundsInScreen(rect)
                        val value = if (node.isPassword) "[password]" else node.text?.toString().orEmpty().take(2000)
                        text.append("\n[$index] ${node.className} ${node.contentDescription ?: ""} text=$value editable=${node.isEditable} clickable=${node.isClickable} bounds=$rect")
                    }
                    val response = result(text.toString())
                    if (bitmap != null) {
                        val maximum = args.optInt("max_image_size", 1280).coerceIn(320, 1920)
                        val factor = minOf(1.0, maximum.toDouble() / maxOf(bitmap.width, bitmap.height))
                        val scaled = Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * factor).toInt()), maxOf(1, (bitmap.height * factor).toInt()), true)
                        val bytes = ByteArrayOutputStream()
                        scaled.compress(Bitmap.CompressFormat.PNG, 100, bytes)
                        response.getJSONArray("content").put(JSONObject().put("type", "image").put("mimeType", "image/png").put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)))
                        if (!preview) { screenWidth = bitmap.width; screenHeight = bitmap.height; imageWidth = scaled.width; imageHeight = scaled.height }
                        if (scaled !== bitmap) scaled.recycle()
                        bitmap.recycle()
                    } else if (!preview) {
                        imageWidth = 0; imageHeight = 0
                        val rect = Rect(); root.getBoundsInScreen(rect); screenWidth = rect.right; screenHeight = rect.bottom
                    }
                    if (!preview) { stateId = id; targetPackage = query; targetWindow = root.windowId; records = nodes }
                    response.put("details", JSONObject().put("stateId", id).put("coordinateSpace", "screenshot"))
                    reply(response)
                } catch (error: Exception) { reply(result(error.message ?: error.toString(), true)) }
            }
            if (args.optString("observation") == "text" || Build.VERSION.SDK_INT < 30) {
                complete(null, "Screenshot unavailable in text mode or Android below 11; use element indices."); return
            }
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    val buffer = screenshot.hardwareBuffer
                    try {
                        val hardware = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                        val bitmap = hardware?.copy(Bitmap.Config.ARGB_8888, false)
                        hardware?.recycle()
                        if (bitmap == null) reply(result("Could not read screenshot buffer", true)) else complete(bitmap)
                    } finally { buffer.close() }
                }
                override fun onFailure(errorCode: Int) {
                    if (preview || args.optString("observation") == "image") reply(result("Android screenshot failed ($errorCode); protected windows cannot be captured", true))
                    else complete(null, "Screenshot failed ($errorCode). Use semantic elements; coordinates are unavailable.")
                }
            })
        } catch (error: Exception) { reply(result(error.message ?: error.toString(), true)) }
    }
}

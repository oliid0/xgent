package com.ohi.xgent.mobileassistant

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import app.tauri.PermissionState
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import java.util.Locale
import java.util.UUID

@InvokeArg
class ResultNotificationArgs { var entryId: String = "" }

internal object ResultNotifications {
    private const val CHANNEL = "xgent.task-results"
    private const val PREFIX = "xgent.result."

    fun permissionState(context: Context, runtimeState: PermissionState? = null): String {
        if (Build.VERSION.SDK_INT >= 33 &&
            (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED ||
                (runtimeState != null && runtimeState != PermissionState.GRANTED))) {
            return if (runtimeState == PermissionState.DENIED) "denied" else "prompt"
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val enabled = manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
        return if (enabled) "granted" else "denied"
    }

    fun post(activity: Activity, invoke: Invoke, runtimeState: PermissionState) {
        val args = invoke.parseArgs(ResultNotificationArgs::class.java)
        activity.runOnUiThread {
            runCatching { postRetained(activity, args.entryId, runtimeState) }
                .onSuccess(invoke::resolveObject)
                .onFailure { invoke.reject("Unable to post result notification: ${it.message}") }
        }
    }

    /** Shared by native foreground delivery and the OS-owned inbox worker. */
    @Synchronized
    fun postRetained(context: Context, entryId: String, runtimeState: PermissionState? = null): String {
        require(UUID.fromString(entryId).toString() == entryId) { "A canonical inbox entry ID is required" }
        val tag = PREFIX + entryId
        val receipts = context.getSharedPreferences("xgent.result-receipts", Context.MODE_PRIVATE)
        if (receipts.getBoolean(tag, false)) return "accepted"
        if (permissionState(context, runtimeState) != "granted") return "blocked"
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val chinese = Locale.getDefault().language == "zh"
        manager.createNotificationChannel(NotificationChannel(CHANNEL,
            if (chinese) "任务结果" else "Task results", NotificationManager.IMPORTANCE_DEFAULT))
        val channel = manager.getNotificationChannel(CHANNEL) ?: error("The notification channel is unavailable")
        if (channel.importance == NotificationManager.IMPORTANCE_NONE) return "blocked"
        if (manager.activeNotifications.none { it.tag == tag && it.id == 0 }) {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: error("The application cannot be opened")
            require(launch.component?.packageName == context.packageName) { "An app-local launch target is required" }
            launch.data = Uri.parse("xgent-internal://result/$entryId")
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            val tap = PendingIntent.getActivity(context, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notice = Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Xgent")
                .setContentText(if (chinese) "有任务结果可供查看。请打开应用收件箱。"
                    else "A task result is available. Open the app inbox.")
                .setContentIntent(tap).setAutoCancel(true).setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PRIVATE).build()
            manager.notify(tag, 0, notice)
        }
        check(receipts.edit().putBoolean(tag, true).commit()) { "Unable to retain notification acceptance" }
        return "accepted"
    }

    fun remove(activity: Activity, invoke: Invoke) {
        val args = invoke.parseArgs(ResultNotificationArgs::class.java)
        require(UUID.fromString(args.entryId).toString() == args.entryId) { "A canonical inbox entry ID is required" }
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(PREFIX + args.entryId, 0)
        invoke.resolve()
    }
}

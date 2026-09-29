package com.ohi.xgent.browserautomation

import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient

/** Activity-owned pickers and runtime permissions for app-owned browser tabs. */
interface BrowserInteractionHost {
    fun openBrowserFileChooser(
        sessionId: String,
        params: WebChromeClient.FileChooserParams,
        callback: ValueCallback<Array<Uri>>,
    )

    fun cancelBrowserFileChooser(sessionId: String)

    fun requestBrowserMedia(
        sessionId: String,
        origin: String,
        permissions: Array<String>,
        completion: (Boolean) -> Unit,
    )

    fun cancelBrowserMedia(sessionId: String)
}

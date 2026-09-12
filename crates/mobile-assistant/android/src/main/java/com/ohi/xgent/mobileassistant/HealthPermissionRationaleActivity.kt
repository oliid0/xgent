package com.ohi.xgent.mobileassistant

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Privacy rationale opened from Health Connect's permission screen. */
class HealthPermissionRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Xgent health data privacy"

        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            setPadding(dp(24), dp(32), dp(24), dp(24))
        }
        content.addView(TextView(this).apply {
            text = "How Xgent uses Health Connect"
            textSize = 24f
            setPadding(0, 0, 0, dp(16))
        })
        content.addView(TextView(this).apply {
            text = "Xgent requests read-only access to your step count only when you ask it to use health data. It does not write health records, read in the background, sell health data, or use it for advertising.\n\nThe selected time range is processed on this device. If you ask an AI model to analyze or summarize the result, that result can be sent to the model provider you configured for the conversation.\n\nYou can revoke access at any time in Health Connect settings."
            textSize = 16f
            setLineSpacing(0f, 1.2f)
        })
        content.addView(Button(this).apply {
            text = "Close"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(24)
        })

        setContentView(ScrollView(this).apply { addView(content) })
    }
}

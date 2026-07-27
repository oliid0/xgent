# Public Tauri command methods are discovered by the Tauri Android bridge.
-keepclassmembers class com.ohi.xagent.mobileexecution.MobileExecutionPlugin {
    @app.tauri.annotation.Command <methods>;
}

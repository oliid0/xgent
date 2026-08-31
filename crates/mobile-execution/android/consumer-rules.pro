# Public Tauri command methods are discovered by the Tauri Android bridge.
-keepclassmembers class com.ohi.xgent.mobileexecution.MobileExecutionPlugin {
    @app.tauri.annotation.Command <methods>;
}

# The Tauri Android build discovers plugin entry points through generated bindings.
-keep class com.ohi.xgent.mobileassistant.NativeResultReceiver { *; }
-keep class com.ohi.xgent.mobileassistant.NativeEventSender { *; }
-keepclassmembers class androidx.work.ListenableWorker { public boolean isStopped(); }

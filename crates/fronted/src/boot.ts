import { showFirstLaunch, showLaunchFailure } from "./lib/system/launchScreen";
import "@oddbird/popover-polyfill";
import "./lib/system/layerCompatibility";
import { inferRuntimePlatform } from "./lib/runtimePlatform";
import { installWebviewNavigationGuard } from "./lib/system/webviewNavigationGuard";
import { isBrowserRuntime } from "./runtime";

if (!isBrowserRuntime()) {
  const platform = inferRuntimePlatform();
  if (platform === "windows" || platform === "macos" || platform === "linux") {
    installWebviewNavigationGuard({
      isMac: platform === "macos",
      allowReloadChords: import.meta.env.DEV,
    });
  }
}

// Only the first initialization may show loading. Later launches reveal the ready app.
showFirstLaunch();
void import("./main").catch((error) => {
  showLaunchFailure();
  console.error("Application startup failed", error);
});

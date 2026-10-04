import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { createNativeLaunchRecovery } from "../../presentation/nativeLaunchRecovery";
import {
  acknowledgeApplePresentation,
  isApplePresentationRuntime,
  publishApplePresentation,
  subscribeApplePresentation,
} from "../../runtime/applePresentation";
import { inferRuntimePlatform } from "../runtimePlatform";

let finishing = false;
let nativeRecovery: ReturnType<typeof createNativeLaunchRecovery> | undefined;

export function showFirstLaunch() {
  if (isApplePresentationRuntime()) {
    document.documentElement.dataset.nativePresentation = "true";
    // A hidden macOS window does not receive WebKit animation frames. The
    // native host must become visible before waiting for any browser paint.
    revealWindow();
    return;
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!finishing) revealWindow();
    }),
  );
}

function isDesktop() {
  return !isBrowserRuntime() && ["windows", "macos", "linux"].includes(inferRuntimePlatform());
}

function revealWindow() {
  if (isDesktop()) {
    void invoke("app_frontend_ready").catch((error) => {
      console.warn("Failed to reveal the application window", error);
    });
  }
}

/** Finish once; native SwiftUI presentation does not depend on a browser paint. */
export function finishLaunch(success = true) {
  nativeRecovery?.dispose();
  nativeRecovery = undefined;
  if (finishing) return;
  finishing = true;
  const finish = () => {
    document.getElementById("launch-error")?.remove();
    if (success) {
      try {
        localStorage.setItem("xgent.launch-completed.v1", "true");
      } catch {}
    }
    revealWindow();
  };
  if (isApplePresentationRuntime()) queueMicrotask(finish);
  else requestAnimationFrame(() => requestAnimationFrame(finish));
}

export function showLaunchFailure(error?: unknown) {
  if (isApplePresentationRuntime()) {
    document.documentElement.dataset.nativePresentation = "true";
    nativeRecovery ??= createNativeLaunchRecovery({
      publish: publishApplePresentation,
      subscribe: subscribeApplePresentation,
      acknowledge: acknowledgeApplePresentation,
      nativeMobile: inferRuntimePlatform() === "ios",
      reload: () => window.location.reload(),
    });
    void nativeRecovery
      .show(error)
      .catch((failure) => console.error("Native startup failure could not be displayed", failure));
    revealWindow();
    return;
  }
  const message = document.getElementById("launch-error");
  if (message) message.hidden = false;
  revealWindow();
}

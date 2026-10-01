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
  if (isApplePresentationRuntime()) document.documentElement.dataset.nativePresentation = "true";
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

/** Reveal the painted application once, without a splash or transition. */
export function finishLaunch(success = true) {
  nativeRecovery?.dispose();
  nativeRecovery = undefined;
  if (finishing) return;
  finishing = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById("launch-error")?.remove();
      if (success) {
        try {
          localStorage.setItem("xgent.launch-completed.v1", "true");
        } catch {}
      }
      revealWindow();
    });
  });
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

import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { inferRuntimePlatform } from "../runtimePlatform";

let finishing = false;

export function showFirstLaunch() {
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

export function showLaunchFailure() {
  const message = document.getElementById("launch-error");
  if (message) message.hidden = false;
  revealWindow();
}

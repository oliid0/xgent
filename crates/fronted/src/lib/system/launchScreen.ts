import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { inferRuntimePlatform } from "../runtimePlatform";

let finishing = false;

export function showFirstLaunch() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!finishing && document.documentElement.dataset.initialized !== "true") revealWindow();
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
      const root = document.getElementById("root");
      root?.removeAttribute("inert");
      document.getElementById("initial-setup")?.remove();
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
  document.getElementById("initial-setup")?.remove();
  const message = document.getElementById("launch-error");
  if (message) message.hidden = false;
  revealWindow();
}

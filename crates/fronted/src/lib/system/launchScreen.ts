import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { inferRuntimePlatform } from "../runtimePlatform";

const LAUNCH_KEY = "xgent.launch-completed.v1";
let finishing = false;

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

export function showFirstLaunch() {
  if (document.documentElement.dataset.warmLaunch !== "true") revealWindow();
}

/** Keep the HTML launch surface alive across React mounting and settings hydration. */
export function finishLaunch(success = true) {
  if (finishing) return;
  finishing = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const shell = document.getElementById("launch-screen");
      const root = document.getElementById("root");
      const warm = document.documentElement.dataset.warmLaunch === "true";
      root?.removeAttribute("inert");
      if (success) {
        try {
          localStorage.setItem(LAUNCH_KEY, "true");
        } catch {
          // Storage can be disabled; readiness and navigation still work.
        }
      }
      if (warm || !success || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        shell?.remove();
      } else if (shell) {
        shell.classList.add("launch-complete");
        shell.addEventListener("transitionend", () => shell.remove(), { once: true });
        window.setTimeout(() => shell.remove(), 700);
      }
      revealWindow();
    });
  });
}

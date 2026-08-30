import { invoke } from "@xagent/runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { LocalAccessPairingGate } from "./components/local-access/LocalAccessPairingGate";
import "./index.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
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

if (import.meta.env.DEV) {
  // Dev console hook for transcript perf work: window.__seedLongConversation()
  void import("./lib/debug/seedLongConversation").then(({ seedLongConversation }) => {
    const devWindow = window as Window & { __seedLongConversation?: typeof seedLongConversation };
    devWindow.__seedLongConversation = seedLongConversation;
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LocalAccessPairingGate>
        <App />
      </LocalAccessPairingGate>
    </AppErrorBoundary>
  </React.StrictMode>,
);

if (!isBrowserRuntime()) {
  const platform = inferRuntimePlatform();
  if (platform === "windows" || platform === "macos" || platform === "linux") {
    requestAnimationFrame(() => {
      void invoke("app_frontend_ready").catch((error) => {
        console.warn("Failed to reveal the frontend-ready window", error);
      });
    });
  }
}

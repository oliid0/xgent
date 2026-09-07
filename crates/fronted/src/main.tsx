import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { LocalAccessPairingGate } from "./components/local-access/LocalAccessPairingGate";
import "./index.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import { inferRuntimePlatform } from "./lib/runtimePlatform";
import { showFirstLaunch } from "./lib/system/launchScreen";
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

showFirstLaunch();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LocalAccessPairingGate>
        <App />
      </LocalAccessPairingGate>
    </AppErrorBoundary>
  </React.StrictMode>,
);

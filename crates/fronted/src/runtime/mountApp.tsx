import React from "react";
import ReactDOM from "react-dom/client";
import App from "../App";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { LocalAccessPairingGate } from "../components/local-access/LocalAccessPairingGate";

/** Loaded only by presentation windows, never by the native execution host. */
export function mountApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <LocalAccessPairingGate>
          <App />
        </LocalAccessPairingGate>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const browserToolSource = readFileSync(
  new URL("../../src/lib/tools/browserUseTools.ts", import.meta.url),
  "utf8",
);
const browserRuntimeSource = readFileSync(
  new URL("../../../browser-automation/shared/browser-runtime.js", import.meta.url),
  "utf8",
);
const desktopBrowserSource = readFileSync(
  new URL("../../../browser-automation/src/desktop.rs", import.meta.url),
  "utf8",
);
const iosBrowserSource = readFileSync(
  new URL("../../../browser-automation/ios/Sources/BrowserAutomationPlugin.swift", import.meta.url),
  "utf8",
);
const androidBrowserSource = readFileSync(
  new URL(
    "../../../browser-automation/android/src/main/java/com/ohi/xgent/browserautomation/BrowserAutomationPlugin.kt",
    import.meta.url,
  ),
  "utf8",
);

function browserResponse(request, overrides = {}) {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    action: request.action,
    url: "https://example.com/",
    title: "Example",
    data: {},
    screenshotBase64: null,
    lifecycle: {
      commandCompleted: true,
      navigationStarted: false,
      navigationFinished: false,
      recovered: false,
    },
    ...overrides,
  };
}

function withBrowserTimers(run) {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    });
}

test("browser client correlates request ids and requires command completion", async () => {
  let mutateResponse = (response) => response;
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(_command, args) {
          return mutateResponse(browserResponse(args.request));
        },
      },
    },
  });
  const { localBrowserAutomationClient } = loader.loadModule("src/lib/browserAutomation.ts");

  await withBrowserTimers(async () => {
    const response = await localBrowserAutomationClient.action("main", "page_info", {}, 500);
    assert.match(response.requestId, /^browser-/);

    mutateResponse = (value) => ({ ...value, requestId: "wrong-request" });
    await assert.rejects(
      localBrowserAutomationClient.action("main", "page_info", {}, 500),
      /response mismatch/,
    );

    mutateResponse = (value) => ({
      ...value,
      lifecycle: { ...value.lifecycle, commandCompleted: false },
    });
    await assert.rejects(
      localBrowserAutomationClient.action("main", "page_info", {}, 500),
      /without command completion/,
    );
  });
});

test("browser session controller preserves the page after a timed-out command", async () => {
  let failedOnce = false;
  let recoveryCalls = 0;
  const unavailableClient = {
    status: async () => ({
      backend: "desktop-webview",
      available: true,
      capabilities: {},
    }),
    listSessions: async () => [
      {
        sessionId: "main",
        url: "https://example.com/",
        title: "Example",
        visible: false,
        loading: false,
      },
    ],
    openSession: async () => {
      throw new Error("unexpected openSession");
    },
    closeSession: async () => {
      throw new Error("unexpected closeSession");
    },
    setViewport: async () => {
      throw new Error("unexpected setViewport");
    },
    action: async (_sessionId, action) => {
      if (action === "recover") {
        recoveryCalls += 1;
        throw new Error("automatic recovery must not run");
      }
      if (!failedOnce) {
        failedOnce = true;
        throw new Error("browser request browser-1 timed out");
      }
      return {
          requestId: "browser-after-timeout",
          sessionId: "main",
          action,
          url: "https://example.com/",
          title: "Example",
          data: { ready: true },
          lifecycle: {
            commandCompleted: true,
            navigationStarted: false,
            navigationFinished: false,
            recovered: false,
          },
      };
    },
  };
  const loader = createTsModuleLoader({
    mocks: {
      "../browserAutomation": { localBrowserAutomationClient: unavailableClient },
    },
  });
  const { BrowserSessionController } = loader.loadModule(
    "src/lib/browser/browserSessionController.ts",
  );
  const controller = new BrowserSessionController(unavailableClient);

  await assert.rejects(controller.action("page_info", {}, { sessionId: "main" }), /timed out/);
  assert.equal(controller.getSnapshot().sessions[0].loading, false);
  assert.equal(controller.getSnapshot().error, "browser request browser-1 timed out");
  assert.equal(recoveryCalls, 0);
  await controller.action("screenshot", {}, { sessionId: "main", background: true });
  assert.equal(
    controller.getSnapshot().error,
    "browser request browser-1 timed out",
    "background thumbnail polling must not erase a foreground command error",
  );
  const next = await controller.action("page_info", {}, { sessionId: "main" });
  assert.deepEqual(next.data, { ready: true });
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(recoveryCalls, 0);
});

test("local browser tool activity reveals the shared agent session", () => {
  assert.match(
    browserToolSource,
    /if \(!delegated\) activeController\.openPanel\(sessionId, "agent"\)/,
  );
  assert.match(browserToolSource, /await controller\.ensureSession\(\{ sessionId \}\);\s*revealAgentSession\(\);/);
});

test("browser snapshots expose trusted human assistance without counting agent DOM events", () => {
  assert.match(
    browserRuntimeSource,
    /if \(!event\.isTrusted \|\| Date\.now\(\) <= nativeAgentInputUntil\) return/,
  );
  assert.match(browserRuntimeSource, /case "__native_input_guard"/);
  assert.match(browserRuntimeSource, /document\.addEventListener\("pointerdown", recordHumanIntervention, true\)/);
  assert.match(browserRuntimeSource, /document\.addEventListener\("input", recordHumanIntervention, true\)/);
  assert.match(browserRuntimeSource, /data\.humanIntervention = \{/);
  assert.match(browserToolSource, /human_assistance_completed/);
  assert.match(browserToolSource, /do not repeat the superseded action/);
  assert.match(browserToolSource, /waitForHumanAssistance\(sessionId/);
  assert.match(browserToolSource, /controller\.action\("snapshot"/);
});

test("all five native browser transports keep one committed-document automation path", () => {
  assert.match(desktopBrowserSource, /WebView2 sessions with CDP trusted input/);
  assert.match(desktopBrowserSource, /CallDevToolsProtocolMethodCompletedHandler/);
  assert.match(desktopBrowserSource, /WKWebView sessions with committed-document DOM automation/);
  assert.match(desktopBrowserSource, /takeSnapshotWithConfiguration_completionHandler/);
  assert.match(desktopBrowserSource, /WebKitGTK sessions with committed-document DOM automation/);
  assert.match(desktopBrowserSource, /PageLoadEvent::Started/);
  assert.match(desktopBrowserSource, /SnapshotRegion::Visible/);

  assert.match(iosBrowserSource, /func webView\(_ webView: WKWebView, didCommit/);
  assert.match(iosBrowserSource, /evaluateDOMActionWhenReady/);
  assert.match(iosBrowserSource, /session\.webView\.takeSnapshot/);
  assert.doesNotMatch(iosBrowserSource, /Browser action timed out[\s\S]{0,500}reload\(\)/);

  assert.match(androidBrowserSource, /override fun onPageCommitVisible/);
  assert.match(androidBrowserSource, /evaluateDomActionWhenReady/);
  assert.match(androidBrowserSource, /webView\.draw\(Canvas\(bitmap\)\)/);
  assert.doesNotMatch(androidBrowserSource, /Browser action timed out[\s\S]{0,500}reload\(\)/);
});

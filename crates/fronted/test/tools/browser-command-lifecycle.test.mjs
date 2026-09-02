import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

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

test("browser session controller recovers a timed-out command before accepting another", async () => {
  let recovered = false;
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
      if (action !== "recover") {
        if (!recovered) throw new Error("browser request browser-1 timed out");
        return {
          requestId: "browser-after-recovery",
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
      }
      recovered = true;
      return {
        requestId: "browser-recovery",
        sessionId: "main",
        action: "recover",
        url: "https://example.com/",
        title: "Example",
        data: { recovered: true },
        lifecycle: {
          commandCompleted: true,
          navigationStarted: true,
          navigationFinished: true,
          recovered: true,
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
  const next = await controller.action("page_info", {}, { sessionId: "main" });
  assert.deepEqual(next.data, { ready: true });
  assert.equal(controller.getSnapshot().error, null);
});

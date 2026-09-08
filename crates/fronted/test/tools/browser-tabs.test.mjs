import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup(action) {
  const sessions = new Map();
  let opens = 0;
  const client = {
    status: async () => ({ available: true }),
    listSessions: async () => [...sessions.values()],
    openSession: async ({ sessionId, url }) => {
      opens++;
      await new Promise((resolve) => setImmediate(resolve));
      const session = { sessionId, url, visible: false, loading: false };
      sessions.set(sessionId, session);
      return session;
    },
    closeSession: async (id) => { sessions.delete(id); },
    setViewport: async (id) => sessions.get(id),
    action,
  };
  const loader = createTsModuleLoader({ mocks: { "../browserAutomation": { localBrowserAutomationClient: client } } });
  const { BrowserSessionController } = loader.loadModule("src/lib/browser/browserSessionController.ts");
  return { controller: new BrowserSessionController(client), client, opens: () => opens };
}

test("concurrent tab creation reserves distinct ids and deduplicates the same agent tab", async () => {
  const { controller, opens } = setup();
  const [a, b] = await Promise.all([controller.newSession(), controller.newSession()]);
  assert.notEqual(a.sessionId, b.sessionId);
  await Promise.all([controller.ensureSession({ sessionId: "main" }), controller.ensureSession({ sessionId: "main" })]);
  assert.equal(opens(), 3);
  assert.equal(controller.getSnapshot().sessions.length, 3);
});

test("viewport and monitor frames do not wait behind a navigation and drag updates coalesce", async () => {
  let finishNavigation;
  let navigationStarted;
  const started = new Promise(resolve => { navigationStarted = resolve; });
  const { controller, client } = setup(async (sessionId, action) => {
    if (action === "screenshot") return { sessionId, action, screenshotBase64: "cG5n" };
    navigationStarted();
    return new Promise(resolve => { finishNavigation = () => resolve({ sessionId, action, url: "https://example.com/final", data: {} }); });
  });
  const tab = await controller.newSession();
  const navigation = controller.action("navigate", { url: "https://example.com/final" }, { sessionId: tab.sessionId });
  await started;
  let finishResize;
  const sizes = [];
  client.setViewport = async (sessionId, viewport) => {
    sizes.push(viewport.width);
    if (sizes.length === 1) await new Promise(resolve => { finishResize = resolve; });
    return { ...tab, sessionId, visible: viewport.visible };
  };
  const viewport = { x: 0, y: 0, width: 300, height: 400, visible: true, scaleFactor: 1 };
  const first = controller.setViewport(tab.sessionId, viewport);
  const middle = controller.setViewport(tab.sessionId, { ...viewport, width: 400 });
  const last = controller.setViewport(tab.sessionId, { ...viewport, width: 500 });
  assert.equal(await controller.captureSessionPreview(tab.sessionId), "data:image/png;base64,cG5n");
  assert.deepEqual(sizes, [300]);
  finishResize();
  await Promise.all([first, middle, last]);
  assert.deepEqual(sizes, [300, 500]);
  finishNavigation();
  await navigation;
  assert.equal(controller.getSnapshot().sessions[0].url, "https://example.com/final");
});

test("closing the last visible browser tab leaves an empty workspace without spawning another", async () => {
  const { controller, opens } = setup();
  const tab = await controller.newSession();
  controller.openPanel(tab.sessionId, "user");
  await controller.closeSession(tab.sessionId);
  assert.equal(controller.getSnapshot().sessions.length, 0);
  assert.equal(opens(), 1);
});

test("new conversations cannot inherit or select another conversation's browser tabs", async () => {
  const { controller } = setup();
  controller.selectConversation("chat-a");
  const a = await controller.newSession("https://example.com/a");
  controller.selectConversation("chat-b");
  assert.equal(controller.getSnapshot().activeSessionId, null);
  assert.equal(controller.sessionsForConversation().length, 0);
  controller.openPanel(a.sessionId);
  assert.equal(controller.getSnapshot().panelOpen, false);
  const b = await controller.newSession();
  assert.equal(b.url, "about:blank");
  await controller.ensureSession({ sessionId: a.sessionId });
  assert.equal(controller.getSnapshot().activeSessionId, b.sessionId);
  await controller.closeSession(b.sessionId);
  assert.equal(controller.getSnapshot().activeSessionId, null);
  controller.selectConversation("chat-a");
  assert.equal(controller.getSnapshot().activeSessionId, a.sessionId);
});

test("local addresses are navigations and file names retain spaces and fragments", () => {
  const loader = createTsModuleLoader({ mocks: { "../browserAutomation": { localBrowserAutomationClient: {} } } });
  const { normalizeBrowserAddress } = loader.loadModule("src/lib/browser/browserSessionController.ts");
  assert.equal(normalizeBrowserAddress("locahost:3000/test"), "http://localhost:3000/test");
  assert.equal(normalizeBrowserAddress("[::1]:8080"), "http://[::1]:8080");
  assert.equal(normalizeBrowserAddress("C:\\Users\\test\\a #1.html"), "file:///C:/Users/test/a%20%231.html");
  assert.equal(normalizeBrowserAddress("/tmp/a #1.html"), "file:///tmp/a%20%231.html");
  assert.equal(normalizeBrowserAddress("file:///tmp/a.html"), "file:///tmp/a.html");
  assert.match(normalizeBrowserAddress("search words"), /search\?q=search%20words/);
});

test("a user intervention suppresses stale agent input and returns the current page", async () => {
  let sequence = 0;
  let clicks = 0;
  const { controller } = setup(async (id, action) => {
    if (action === "click") clicks++;
    return { sessionId: id, action, url: "https://example.com", data: { humanIntervention: { sequence, documentId: "one" } } };
  });
  await controller.action("snapshot", {}, { agent: true });
  sequence++;
  const response = await controller.action("click", {}, { agent: true });
  assert.equal(clicks, 0);
  assert.equal(response.data.actionApplied, false);
});

test("a failed post-action capture does not erase dispatch evidence or allow an immediate replay", async () => {
  let clicks = 0;
  let failSnapshot = false;
  const { controller } = setup(async (id, action) => {
    if (action === "click") { clicks++; failSnapshot = true; }
    if (action === "snapshot" && failSnapshot) throw new Error("capture unavailable");
    return { sessionId: id, action, url: "https://example.com", data: { humanIntervention: { sequence: 0, documentId: "one" } } };
  });
  await controller.action("snapshot", {}, { agent: true });
  const response = await controller.action("click", {}, { agent: true });
  assert.equal(response.data.actionApplied, true);
  assert.match(response.data.observationError, /capture unavailable/);
  failSnapshot = false;
  const refreshed = await controller.action("click", {}, { agent: true });
  assert.equal(refreshed.data.actionApplied, false);
  assert.equal(clicks, 1);
});

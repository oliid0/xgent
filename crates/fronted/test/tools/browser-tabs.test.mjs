import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup(action, openTabListener) {
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
  return { controller: new BrowserSessionController(client, openTabListener), client, opens: () => opens };
}

const flushPopups = async () => {
  for (let index = 0; index < 3; index++) await new Promise(resolve => setImmediate(resolve));
};

test("shared native popup listener creates one real tab with both presentation subscribers", async () => {
  let callback, registrations = 0, cleanups = 0;
  const { controller, opens } = setup(undefined, async handler => {
    registrations++; callback = handler;
    return () => { cleanups++; };
  });
  controller.selectConversation("chat-a");
  const source = await controller.newSession("https://example.test/source");
  const leaveWeb = controller.subscribe(() => {}), leaveNative = controller.subscribe(() => {});
  controller.openPanel(source.sessionId, "user");
  callback({ sessionId: source.sessionId, url: "https://example.test/destination?q=1" });
  await flushPopups();
  assert.equal(registrations, 1);
  assert.equal(opens(), 2);
  const destination = controller.sessionsForConversation().find(tab => tab.sessionId !== source.sessionId);
  assert.equal(destination.url, "https://example.test/destination?q=1");
  assert.equal(controller.getSnapshot().activeSessionId, destination.sessionId);
  leaveWeb(); await flushPopups(); assert.equal(cleanups, 0);
  leaveNative(); await flushPopups(); assert.equal(cleanups, 1);
  callback({ sessionId: destination.sessionId, url: "https://example.test/retired" });
  await flushPopups(); assert.equal(opens(), 2);
});

test("popup routing rejects malformed, hidden, foreign, inactive and unsafe destinations", async () => {
  let callback;
  const { controller, opens } = setup(undefined, async handler => { callback = handler; return () => {}; });
  controller.selectConversation("chat-a");
  const source = await controller.newSession(), background = await controller.newSession();
  const leave = controller.subscribe(() => {});
  controller.openPanel(source.sessionId, "user");
  for (const request of [null, {}, { sessionId: source.sessionId, url: 42 },
    { sessionId: background.sessionId, url: "https://example.test" },
    ...["file:///tmp/private", "javascript:alert(1)", "data:text/html,hi", "about:blank", "invalid"].map(url => ({ sessionId: source.sessionId, url }))]) callback(request);
  controller.closePanel(); callback({ sessionId: source.sessionId, url: "https://example.test/hidden" });
  controller.selectConversation("chat-b");
  const other = await controller.newSession(); controller.openPanel(other.sessionId, "user");
  callback({ sessionId: source.sessionId, url: "https://example.test/foreign" });
  await flushPopups(); assert.equal(opens(), 3); assert.equal(controller.sessionsForConversation().length, 1);
  leave();
});

test("late popup registration is retired and does not disconnect its replacement", async () => {
  const callbacks = [], resolveRegistrations = [], cleaned = [];
  const { controller, opens } = setup(undefined, handler => {
    const id = callbacks.push(handler);
    return new Promise(resolve => resolveRegistrations.push(() => resolve(() => cleaned.push(id))));
  });
  const source = await controller.newSession(); controller.openPanel(source.sessionId, "user");
  const leaveFirst = controller.subscribe(() => {}); leaveFirst();
  const leaveSecond = controller.subscribe(() => {});
  resolveRegistrations[0](); await flushPopups(); assert.deepEqual(cleaned, [1]);
  callbacks[0]({ sessionId: source.sessionId, url: "https://example.test/stale" });
  callbacks[1]({ sessionId: source.sessionId, url: "https://example.test/live" });
  await flushPopups(); assert.equal(opens(), 2);
  leaveSecond(); resolveRegistrations[1](); await flushPopups(); assert.deepEqual(cleaned, [1, 2]);
});

test("popup completion preserves a new conversation or manually selected tab and exposes actual errors", async () => {
  let callback;
  const { controller, client } = setup(undefined, async handler => { callback = handler; return () => {}; });
  controller.selectConversation("chat-a"); const source = await controller.newSession();
  controller.selectConversation("chat-b"); const other = await controller.newSession();
  controller.selectConversation("chat-a"); controller.openPanel(source.sessionId, "user");
  const leave = controller.subscribe(() => {});
  const originalOpen = client.openSession; let complete;
  client.openSession = args => new Promise(resolve => { complete = () => originalOpen(args).then(resolve); });
  callback({ sessionId: source.sessionId, url: "https://example.test/slow" });
  await flushPopups(); controller.selectConversation("chat-b"); controller.openPanel(other.sessionId, "user");
  complete(); await flushPopups(); assert.equal(controller.getSnapshot().activeSessionId, other.sessionId);
  assert.equal(controller.sessionsForConversation("chat-a").length, 2);
  controller.selectConversation("chat-a"); controller.openPanel(source.sessionId, "user");
  const selected = controller.sessionsForConversation().find(tab => tab.sessionId !== source.sessionId);
  callback({ sessionId: source.sessionId, url: "https://example.test/another-slow-popup" });
  await flushPopups(); controller.selectSession(selected.sessionId);
  complete(); await flushPopups(); assert.equal(controller.getSnapshot().activeSessionId, selected.sessionId);
  controller.selectSession(source.sessionId);
  client.openSession = async () => { throw Error("Native browser rejected new tab"); };
  callback({ sessionId: source.sessionId, url: "https://example.test/error" });
  await flushPopups(); assert.match(controller.getSnapshot().error, /Native browser rejected/);
  assert.equal(controller.getSnapshot().activeSessionId, source.sessionId); leave();
});

test("clearing sessions removes every successful close and retains failed sessions with their actual error", async () => {
  const { controller, client } = setup();
  controller.selectConversation("chat-a");
  const a = await controller.newSession(), b = await controller.newSession(), c = await controller.newSession();
  const closed = [];
  client.closeSession = async id => { closed.push(id); if (id === b.sessionId) throw Error("engine refused"); };
  await assert.rejects(controller.closeAllSessions(), /engine refused/);
  assert.deepEqual(closed, [a.sessionId, b.sessionId, c.sessionId]);
  assert.deepEqual(controller.getSnapshot().sessions.map(item => item.sessionId), [b.sessionId]);
  assert.equal(controller.getSnapshot().activeSessionId, b.sessionId);
  assert.match(controller.getSnapshot().error, /engine refused/);
  client.closeSession = async () => {};
  await controller.closeAllSessions();
  assert.equal(controller.sessionsForConversation().length, 0);
  assert.equal(controller.getSnapshot().error, null);
});

test("concurrent session cleanup shares one request and preserves tabs created after it started", async () => {
  const { controller, client } = setup();
  const original = await controller.newSession();
  let finish, started;
  const signal = new Promise(resolve => { started = resolve; });
  const closes = [];
  client.closeSession = async id => { closes.push(id); started(); await new Promise(resolve => { finish = resolve; }); };
  const first = controller.closeAllSessions();
  assert.equal(controller.closeAllSessions(), first);
  await signal;
  const fresh = await controller.newSession(); finish(); await first;
  assert.deepEqual(closes, [original.sessionId]);
  assert.deepEqual(controller.getSnapshot().sessions.map(item => item.sessionId), [fresh.sessionId]);
  assert.equal(controller.getSnapshot().activeSessionId, fresh.sessionId);
});

test("explicit browser opens request native focus without agent output repeatedly stealing the tab", async () => {
  const { controller } = setup(async (id, action) => ({ sessionId: id, action }));
  await controller.ensureSession({ sessionId: "main" });
  assert.equal(controller.getSnapshot().panelFocusRequest, 0);
  controller.openPanel("main", "user");
  assert.equal(controller.getSnapshot().panelFocusRequest, 1);
  controller.openPanel("main", "agent");
  assert.equal(controller.getSnapshot().panelFocusRequest, 1);
  controller.closePanel();
  controller.openPanel("main", "user");
  assert.equal(controller.getSnapshot().panelFocusRequest, 2);
});

test("concurrent tab creation reserves distinct ids and deduplicates the same agent tab", async () => {
  const { controller, opens } = setup();
  const [a, b] = await Promise.all([controller.newSession(), controller.newSession()]);
  assert.notEqual(a.sessionId, b.sessionId);
  await Promise.all([controller.ensureSession({ sessionId: "main" }), controller.ensureSession({ sessionId: "main" })]);
  assert.equal(opens(), 3);
  assert.equal(controller.getSnapshot().sessions.length, 3);
});

test("new conversation tab skips an occupied mapped tab id", async () => {
  const { controller, opens } = setup();
  controller.selectConversation("chat-a");
  const occupiedId = controller.sessionIdForConversation("chat-a", "tab-1");
  await controller.ensureSession({ sessionId: occupiedId });
  const created = await controller.newSession();
  assert.notEqual(created.sessionId, occupiedId);
  assert.equal(opens(), 2);
  assert.equal(controller.sessionsForConversation().length, 2);
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

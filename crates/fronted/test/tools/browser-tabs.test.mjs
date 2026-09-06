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
  return { controller: new BrowserSessionController(client), opens: () => opens };
}

test("concurrent tab creation reserves distinct ids and deduplicates the same agent tab", async () => {
  const { controller, opens } = setup();
  const [a, b] = await Promise.all([controller.newSession(), controller.newSession()]);
  assert.notEqual(a.sessionId, b.sessionId);
  await Promise.all([controller.ensureSession({ sessionId: "main" }), controller.ensureSession({ sessionId: "main" })]);
  assert.equal(opens(), 3);
  assert.equal(controller.getSnapshot().sessions.length, 3);
});

test("closing the last visible browser tab leaves an empty workspace without spawning another", async () => {
  const { controller, opens } = setup();
  const tab = await controller.newSession();
  controller.openPanel(tab.sessionId, "user");
  await controller.closeSession(tab.sessionId);
  assert.equal(controller.getSnapshot().sessions.length, 0);
  assert.equal(opens(), 1);
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

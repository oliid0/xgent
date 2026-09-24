import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

async function listAgentTabs(localAvailable) {
  const calls = { local: 0, remote: 0 };
  const client = (host, available) => ({
    async status() {
      calls[host] += 1;
      return { available };
    },
    async listSessions() {
      return [{ sessionId: host, url: `https://${host}.example.com`, title: host }];
    },
  });
  const local = client("local", localAvailable);
  const remote = client("remote", true);
  const loader = createTsModuleLoader({
    mocks: {
      "../browserAutomation": {
        localBrowserAutomationClient: local,
        createLanPcBrowserAutomationClient: () => remote,
      },
    },
  });
  const { createBrowserUseTools } = loader.loadModule("src/lib/tools/browserUseTools.ts");
  const bundle = createBrowserUseTools({
    delegateToLanPc: { enabled: true, baseUrl: "http://desktop:28367" },
  });
  const result = await bundle.executeToolCall({
    id: "browser-call",
    name: "browser_use",
    arguments: { action: "list_tabs" },
  });
  return { calls, result };
}

test("paired mobile agent uses its visible local browser when available", async () => {
  const { calls, result } = await listAgentTabs(true);
  assert.equal(result.isError, false);
  assert.equal(result.details.result[0].sessionId, "local");
  assert.equal(calls.remote, 0);
});

test("paired mobile agent falls back to the PC browser when the local browser is unavailable", async () => {
  const { calls, result } = await listAgentTabs(false);
  assert.equal(result.isError, false);
  assert.equal(result.details.result[0].sessionId, "remote");
  assert.equal(calls.local, 1);
  assert.equal(calls.remote, 1);
});

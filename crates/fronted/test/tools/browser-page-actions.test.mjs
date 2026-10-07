import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("page actions use actual viewing-device clipboard/opener and surface failures", async () => {
  const calls = []; let copies = true;
  const { canOpenBrowserPage, runBrowserPageAction } = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { openUrl: async url => calls.push(["open", url]) },
    "../system/clipboardText": { writeClipboardText: async url => { calls.push(["copy", url]); return copies; } },
  } }).loadModule("src/lib/browser/browserPageActions.ts");
  for (const url of [undefined, "", "about:blank", "file:///workspace/private", "javascript:alert(1)", "invalid"]) {
    assert.equal(canOpenBrowserPage(url), false);
    await assert.rejects(runBrowserPageAction("open_external", url));
  }
  assert.deepEqual(calls, []);
  await runBrowserPageAction("copy_address", "https://example.test/page");
  await runBrowserPageAction("open_external", "http://localhost:3000");
  assert.deepEqual(calls, [["copy", "https://example.test/page"], ["open", "http://localhost:3000"]]);
  copies = false;
  await assert.rejects(runBrowserPageAction("copy_address", "https://example.test"), /copy/);
});

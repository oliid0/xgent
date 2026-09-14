import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const preferences = createTsModuleLoader().loadModule("src/lib/chat/layoutPreferences.ts");
const chatPageSource = readFileSync(new URL("../../src/pages/ChatPage.tsx", import.meta.url), "utf8");

function memoryStorage(value = null) {
  const values = new Map(value === null ? [] : [["xgent.chat-layout.v1", value]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => values.set(key, next),
    values,
  };
}

test("chat layout preferences preserve both desktop sidebar visibility states", () => {
  const storage = memoryStorage();
  preferences.saveChatLayoutPreferences({ leftSidebarOpen: true }, storage);
  preferences.saveChatLayoutPreferences({ rightSidebarOpen: true }, storage);
  assert.deepEqual(preferences.readChatLayoutPreferences(storage), {
    leftSidebarOpen: true,
    rightSidebarOpen: true,
  });
});

test("chat layout preferences safely migrate invalid or partial storage", () => {
  assert.deepEqual(
    preferences.readChatLayoutPreferences(memoryStorage("not-json")),
    preferences.DEFAULT_CHAT_LAYOUT_PREFERENCES,
  );
  assert.deepEqual(
    preferences.readChatLayoutPreferences(memoryStorage('{"leftSidebarOpen":true}')),
    { leftSidebarOpen: true, rightSidebarOpen: false },
  );
});

test("leaving compact mode cannot overwrite restored desktop sidebar state", () => {
  assert.match(chatPageSource, /const layoutPersistenceMobileRef = useRef\(mobileExperience\)/);
  assert.match(
    chatPageSource,
    /useLayoutEffect\(\(\) => \{\s*const wasMobile = layoutPersistenceMobileRef\.current/,
  );
  assert.match(chatPageSource, /if \(wasMobile !== mobileExperience\) return/);
  assert.match(chatPageSource, /if \(mobileExperience\) return/);
});

test("desktop panel widths retain their user-adjusted values", () => {
  for (const autoSaveId of [
    "xgent-chat-sidebar-width",
    "xgent-workspace-panel-width",
    "xgent-workspace-hub-panel-width",
    "xgent-chat-auxiliary-panel-width",
  ]) {
    assert.match(chatPageSource, new RegExp(`autoSaveId: "${autoSaveId}"`));
  }
});

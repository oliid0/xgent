import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const preferences = createTsModuleLoader().loadModule("src/lib/chat/layoutPreferences.ts");

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

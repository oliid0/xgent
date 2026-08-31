import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const floorModel = loader.loadModule("src/lib/chat-floor-nav/floorModel.ts");
const floorBookmarks = loader.loadModule("src/lib/chat-floor-nav/floorBookmarks.ts");

function userItem(key, text, messageId) {
  return {
    kind: "user",
    key,
    segmentIndex: 0,
    messageRef: messageId
      ? { segmentIndex: 0, messageIndex: 0, segmentId: "seg", messageId, role: "user", contentHash: "h" }
      : undefined,
    text,
    attachments: [],
    timestamp: 0,
    isFromCompactedSegment: false,
  };
}

test("buildFloorEntries keeps only user items and builds previews", () => {
  const items = [
    { kind: "summary", key: "s1" },
    userItem("u1", "  帮我看看\n这个 bug   在哪 ", "user-aaa"),
    { kind: "assistant", key: "a1", rounds: [] },
    userItem("u2", "x".repeat(60), "user-bbb"),
    userItem("u3", "   ", undefined),
  ];
  const floors = floorModel.buildFloorEntries(items);
  assert.equal(floors.length, 3);
  assert.deepEqual(
    floors.map((f) => f.rowKey),
    ["u1", "u2", "u3"],
  );
  assert.equal(floors[0].preview, "帮我看看 这个 bug 在哪");
  assert.equal(floors[0].messageId, "user-aaa");
  assert.ok(floors[1].preview.endsWith("…"));
  assert.equal(floors[1].preview.length, 49);
  assert.equal(floors[2].preview, "…");

  assert.equal(floors[2].messageId, "u3");
});

test("buildFloorEntries attaches the following assistant text preview", () => {
  const floors = floorModel.buildFloorEntries([
    userItem("u1", "question", "user-1"),
    {
      kind: "assistant",
      key: "a1",
      rounds: [
        {
          blocks: [
            { kind: "text", text: "answer" },
            { kind: "tool", text: "ignored tool output" },
            { kind: "text", text: "with useful context" },
          ],
        },
      ],
    },
  ]);
  assert.equal(floors[0].responsePreview, "answer with useful context");
});

test("buildFloorEntries keeps xx response preview length and pending assistant pairing", () => {
  const floors = floorModel.buildFloorEntries([
    userItem("u1", "first", "user-1"),
    { kind: "summary", key: "s1" },
    {
      kind: "assistant",
      key: "a1",
      rounds: [{ blocks: [{ kind: "text", text: "x".repeat(220) }] }],
    },
  ]);
  assert.equal(floors[0].responsePreview.length, 181);
  assert.ok(floors[0].responsePreview.endsWith("…"));
});

test("sampleFloorEntries keeps bookmarked floors and stays continuous at the cap", () => {
  const floors = Array.from({ length: 100 }, (_, i) =>
    floorModel.buildFloorEntries([userItem(`u${i}`, `msg ${i}`, `user-${i}`)])[0],
  );
  const mustKeep = new Set(["u37", "u73"]);
  const sampled = floorModel.sampleFloorEntries(floors, 20, mustKeep);
  assert.ok(sampled.length <= 20 + mustKeep.size);
  assert.ok(sampled.some((f) => f.rowKey === "u37"));
  assert.ok(sampled.some((f) => f.rowKey === "u73"));
  assert.equal(sampled[0].rowKey, "u0");
  assert.equal(sampled[sampled.length - 1].rowKey, "u99");


  const floors25 = floors.slice(0, 25);
  const sampled25 = floorModel.sampleFloorEntries(floors25, 24, new Set());
  assert.ok(sampled25.length >= 23, `expected >=23 markers, got ${sampled25.length}`);
});

test("resolveNearestSampledRowKey maps active floor to nearest marker", () => {
  const floors = Array.from({ length: 10 }, (_, i) =>
    floorModel.buildFloorEntries([userItem(`u${i}`, `msg ${i}`, `user-${i}`)])[0],
  );
  const sampled = [floors[0], floors[5], floors[9]];
  assert.equal(floorModel.resolveNearestSampledRowKey(floors, sampled, "u5"), "u5");
  assert.equal(floorModel.resolveNearestSampledRowKey(floors, sampled, "u6"), "u5");
  assert.equal(floorModel.resolveNearestSampledRowKey(floors, sampled, "u8"), "u9");
  assert.equal(floorModel.resolveNearestSampledRowKey(floors, sampled, null), null);
  assert.equal(floorModel.resolveNearestSampledRowKey(floors, sampled, "missing"), null);
});

test("buildFloorPreview truncates on code points without splitting surrogates", () => {
  const emoji = "😀".repeat(60);
  const preview = floorModel.buildFloorPreview(emoji);
  assert.ok(preview.endsWith("…"));
  const chars = Array.from(preview);
  assert.equal(chars.length, 49);
  for (const ch of chars.slice(0, -1)) {
    assert.equal(ch, "😀", `expected intact emoji, got ${JSON.stringify(ch)}`);
  }
});

test("floor bookmarks toggle and persist through localStorage", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  try {
    floorBookmarks.resetFloorBookmarksCacheForTest();
    assert.equal(floorBookmarks.getFloorBookmarks("conv-1").size, 0);

    let notified = 0;
    const unsubscribe = floorBookmarks.subscribeFloorBookmarks(() => {
      notified += 1;
    });

    floorBookmarks.toggleFloorBookmark("conv-1", "user-aaa");
    assert.ok(floorBookmarks.getFloorBookmarks("conv-1").has("user-aaa"));
    assert.equal(notified, 1);


    const snapshot = floorBookmarks.getFloorBookmarks("conv-1");
    assert.equal(floorBookmarks.getFloorBookmarks("conv-1"), snapshot);


    floorBookmarks.resetFloorBookmarksCacheForTest();
    assert.ok(floorBookmarks.getFloorBookmarks("conv-1").has("user-aaa"));

    floorBookmarks.toggleFloorBookmark("conv-1", "user-aaa");
    assert.equal(floorBookmarks.getFloorBookmarks("conv-1").size, 0);
    unsubscribe();


    store.set("xgent.floor-bookmarks.v1", "{not json");
    floorBookmarks.resetFloorBookmarksCacheForTest();
    assert.equal(floorBookmarks.getFloorBookmarks("conv-1").size, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

test("bookmark eviction trims memory and disk together", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  try {
    floorBookmarks.resetFloorBookmarksCacheForTest();
    for (let i = 0; i < 205; i++) {
      floorBookmarks.toggleFloorBookmark(`conv-${i}`, `user-${i}`);
    }

    assert.equal(floorBookmarks.getFloorBookmarks("conv-0").size, 0);
    assert.equal(floorBookmarks.getFloorBookmarks("conv-204").size, 1);

    floorBookmarks.resetFloorBookmarksCacheForTest();
    assert.equal(floorBookmarks.getFloorBookmarks("conv-0").size, 0);
    assert.equal(floorBookmarks.getFloorBookmarks("conv-204").size, 1);
    const payload = JSON.parse(store.get("xgent.floor-bookmarks.v1"));
    assert.ok(Object.keys(payload.conversations).length <= 200);
  } finally {
    delete globalThis.localStorage;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("activity panels display successive browser and CUA frames for the selected tool", () => {
  let frames = [];
  const ui = Object.fromEntries(["AspectRatio", "Banner", "Button", "Collapsible", "EmptyState", "Icon", "Text"].map(name => [
    `@astryxdesign/core/${name}`, { [name]: name },
  ]));
  const loader = createTsModuleLoader({ mocks: {
    ...ui,
    "@astryxdesign/core/Layout": { HStack: "HStack", VStack: "VStack" },
    react: {
      useEffect() {}, useMemo: run => run(), useRef: () => ({ current: null }),
      useState: initial => [initial, () => {}],
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    },
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../components/chat/ImagePreview": { ImagePreviewPanel: "ImagePreviewPanel" },
    "../../../components/icons": {},
    "../components/assistant-bubble/ToolCallItem": { ToolCallDetail: "ToolCallDetail" },
    "./ActivityTerminal": { ActivityTerminal: "ActivityTerminal" },
    "../../../lib/browser/browserSessionController": { browserSessionController: {
      subscribe() {}, getSnapshot: () => ({ busySessionIds: [], previewDataUrls: {} }),
      sessionsForConversation: () => [],
    } },
    "../../../lib/chat/executionActivityStore": {
      executionActivityStore: { subscribe() {}, getSnapshot: () => frames },
    },
  } });
  const { MobileToolActivity } = loader.loadModule("src/pages/chat/mobile/MobileToolActivity.tsx");
  const findScreen = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.map(findScreen).find(Boolean);
    if (node.type === "img" && node.props.className === "xgent-activity-screen") return node;
    return findScreen(node.props?.children);
  };
  for (const [kind, name] of [["browser", "browser_use"], ["cua", "cua"]]) {
    const item = { toolCall: { id: "selected-call", name, arguments: {} } };
    const store = { subscribe() {}, getSnapshot: () => ({
      isSettled: false, toolStatus: null,
      liveRounds: [{ round: 0, runningToolCallIds: [item.toolCall.id], blocks: [{ kind: "tool", item }] }],
    }) };
    const render = () => MobileToolActivity({ conversationId: "chat", historyItems: [], store,
      open: true, view: "panel", onOpen() {}, onClose() {},
    });
    for (const imageUrl of ["data:image/png;base64,first", "data:image/png;base64,second"]) {
      frames = [{ id: "monitor", toolCallId: item.toolCall.id, kind, imageUrl, title: "Live", text: "" }];
      assert.equal(findScreen(render())?.props.src, imageUrl);
    }
    frames = [{ id: "other", toolCallId: "unrelated-call", kind, imageUrl: "wrong", title: "Other", text: "" }];
    assert.equal(findScreen(render()), undefined, "a frame from another tool must not replace this activity");
  }
});

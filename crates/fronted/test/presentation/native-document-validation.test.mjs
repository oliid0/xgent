import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { validatePresentationDocument } = loader.loadModule(
  "src/presentation/validateDocument.ts",
);

test("desktop panels require a valid focus token, translated controls and a real close handler", () => {
  const { createNativeWorkspacePanel } = loader.loadModule("src/presentation/nativeWorkspacePanel.ts");
  const handlers = new Map([["close", { enabled: true, accepts: value => value === null, run() {} }]]);
  const panel = { ...document({ id: "content", kind: "Text", text: "Actual content" }),
    ...createNativeWorkspacePanel(key => key, false, 2), formFactor: "desktop", dismissAction: "close" };
  assert.doesNotThrow(() => validatePresentationDocument(panel, handlers));
  assert.equal(createNativeWorkspacePanel(key => key, true).mode, "root");
  for (const patch of [{ formFactor: "mobile" }, { dismissAction: undefined },
    { workspacePanel: undefined }, { workspacePanel: { ...panel.workspacePanel, focusRequest: -1 } },
    { workspacePanel: { ...panel.workspacePanel, closeLabel: " " } },
    { workspacePanel: { ...panel.workspacePanel, closeTabLabel: " " } }]) {
    assert.throws(() => validatePresentationDocument({ ...panel, ...patch }, handlers), /workspace panel/);
  }
});

test("text commits require a separate live string handler on a single-line input", () => {
  const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
  const c = presentationControls("provider-a");
  const input = c.committedInput("host", "Proxy host", "", () => {}, () => {});
  assert.notEqual(input.action, input.commitAction);
  assert.doesNotThrow(() => validatePresentationDocument(document(input), c.handlers));
  for (const patch of [{ kind: "TextArea" }, { action: undefined },
    { commitAction: "" }, { commitAction: input.action }, { commitAction: "retired" }]) {
    assert.throws(() => validatePresentationDocument(document({ ...input, ...patch }), c.handlers), /text commit action/);
  }
});

function document(node) {
  return {
    version: 1,
    surface: "test",
    revision: 1,
    mode: "root",
    title: "Test",
    appearance: "system",
    nodes: [node],
  };
}

test("native documents accept mapped components, properties, and typed actions", () => {
  const handlers = new Map([
    ["send", { enabled: true, accepts: (value) => value === null, run() {} }],
  ]);
  assert.doesNotThrow(() =>
    validatePresentationDocument(
      document({
        id: "send",
        kind: "Button",
        label: "Send",
        action: "send",
        size: "large",
        accessibilityHint: "Sends the current message",
      }),
      handlers,
    ),
  );
});

test("native documents reject unknown properties, missing handlers, and actions on static nodes", () => {
  assert.throws(
    () => validatePresentationDocument(document({ id: "x", kind: "Text", text: "x", mystery: 1 }), new Map()),
    /property/,
  );
  assert.throws(
    () => validatePresentationDocument(document({ id: "x", kind: "Button", action: "missing" }), new Map()),
    /handler/,
  );
  assert.throws(
    () =>
      validatePresentationDocument(
        document({ id: "x", kind: "Text", action: "bad" }),
        new Map([["bad", { enabled: true, accepts: () => true, run() {} }]]),
      ),
    /mapped event/,
  );
});

test("focus requests accept safe nonnegative composer tokens and reject unsupported targets", () => {
  for (const focusRequest of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => validatePresentationDocument(
      document({ id: "draft", kind: "ComposerInput", focusRequest }), new Map(),
    ));
  }
  for (const focusRequest of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(() => validatePresentationDocument(
      document({ id: "draft", kind: "ComposerInput", focusRequest }), new Map(),
    ), /focus request/);
  }
  assert.throws(() => validatePresentationDocument(
    document({ id: "text", kind: "Text", focusRequest: 1 }), new Map(),
  ), /focus request/);
});

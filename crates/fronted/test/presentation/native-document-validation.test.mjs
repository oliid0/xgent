import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { validatePresentationDocument } = loader.loadModule(
  "src/presentation/validateDocument.ts",
);

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

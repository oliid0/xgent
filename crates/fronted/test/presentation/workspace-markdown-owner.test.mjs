import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Markdown relative images use their preview port and discard a same-path former-device response", async () => {
  const parent = createReactHookHarness(), child = createReactHookHarness();
  let hooks = parent, context;
  const calls = [], wait = Promise.withResolvers();
  const react = { memo: fn => fn, createContext: () => ({ Provider: "Provider" }), useContext: () => context };
  for (const name of ["useRef", "useState", "useMemo", "useCallback", "useEffect"]) react[name] = (...args) => hooks.react[name](...args);
  const loader = createTsModuleLoader({ mocks: {
    react,
    [fileURLToPath(new URL("../../src/components/Markdown.tsx", import.meta.url))]: { Markdown: "Markdown", ExternalLinkModal: "ExternalLinkModal" },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "@astryxdesign/core/Stack": { Stack: "Stack" },
    "@astryxdesign/core/Text": { Text: "Text" },
    "@astryxdesign/core/Button": { Button: "Button" },
  } });
  const { WorkspaceMarkdownPreview } = loader.loadModule("src/components/workspace-editor/WorkspaceMarkdownPreview.tsx");
  const a = { invoke: (command, args) => { calls.push(["a", command, args]); return wait.promise; } };
  const b = { invoke: async (command, args) => { calls.push(["b", command, args]); return { mimeType: "image/png", data: "Yg==" }; } };
  const props = { workdir: "/project", markdownPath: "docs/report.md", content: "![Diagram](diagram.png)", commandPort: a };
  let image;
  const render = () => {
    hooks = parent;
    const provider = parent.render(() => WorkspaceMarkdownPreview(props)).props.children;
    context = provider.props.value;
    const component = provider.props.children.props.componentOverrides.img;
    hooks = child;
    return child.render(() => { image = component({ src: "diagram.png", alt: "Diagram" }); return image.type(image.props); });
  };
  const previous = globalThis.window, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created = [], revoked = [];
  globalThis.window = { atob };
  URL.createObjectURL = blob => { created.push(blob); return "blob:owned-image"; };
  URL.revokeObjectURL = value => revoked.push(value);
  try {
    render(); props.commandPort = b; render();
    await new Promise(setImmediate); render();
    assert.deepEqual(calls.map(([id, command, args]) => [id, command, args.workdir, args.path]),
      [["a", "fs_read_workspace_image", "/project", "docs/diagram.png"], ["b", "fs_read_workspace_image", "/project", "docs/diagram.png"]]);
    wait.resolve({ mimeType: "image/png", data: "YQ==" }); await new Promise(setImmediate); render();
    assert.equal(created.length, 1);
    assert.equal(await created[0].text(), "b");
    child.unmount(); assert.deepEqual(revoked, ["blob:owned-image"]);
  } finally {
    wait.resolve({ mimeType: "image/png", data: "YQ==" }); parent.unmount(); child.unmount();
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

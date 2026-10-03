import { registerHooks } from "node:module";
const commonAPI = new URL("./monaco-grammar-api.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/monaco-editor/esm/vs/languages/definitions/") && specifier === "../../../editor/editor.api.js")
      return { url: commonAPI, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

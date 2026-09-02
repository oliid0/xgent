const SANDBOXED_HTML_PREVIEW_BOOTSTRAP = [
  "<script data-xgent-html-preview-bootstrap>",
  "(() => {",
  "  function createStorage() {",
  "    const values = new Map();",
  "    const storage = {",
  "      get length() { return values.size; },",
  "      key(index) { return Array.from(values.keys())[Number(index)] ?? null; },",
  "      getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },",
  "      setItem(key, value) { values.set(String(key), String(value)); },",
  "      removeItem(key) { values.delete(String(key)); },",
  "      clear() { values.clear(); }",
  "    };",
  "    return new Proxy(storage, {",
  "      get(target, key, receiver) {",
  "        if (typeof key !== 'string' || key in target) return Reflect.get(target, key, receiver);",
  "        return target.getItem(key);",
  "      },",
  "      set(target, key, value, receiver) {",
  "        if (typeof key !== 'string' || key in target) return Reflect.set(target, key, value, receiver);",
  "        target.setItem(key, value);",
  "        return true;",
  "      },",
  "      deleteProperty(target, key) {",
  "        if (typeof key === 'string') { target.removeItem(key); return true; }",
  "        return Reflect.deleteProperty(target, key);",
  "      }",
  "    });",
  "  }",
  "  for (const name of ['localStorage', 'sessionStorage']) {",
  "    try {",
  "      Object.defineProperty(window, name, { value: createStorage(), configurable: true });",
  "    } catch {}",
  "  }",
  "})();",
  "</" + "script>",
].join("");

/**
 * Adds an in-memory Storage implementation before workspace HTML executes.
 * Sandboxed `srcDoc` previews have an opaque origin, where direct access to
 * localStorage/sessionStorage otherwise throws before the page can render.
 */
export function buildSandboxedHtmlPreviewSource(html: string) {
  const source = html.startsWith("\uFEFF") ? html.slice(1) : html;
  const headMatch = /<head(?:\s[^>]*)?>/i.exec(source);
  if (headMatch) {
    const insertionIndex = headMatch.index + headMatch[0].length;
    return `${source.slice(0, insertionIndex)}${SANDBOXED_HTML_PREVIEW_BOOTSTRAP}${source.slice(
      insertionIndex,
    )}`;
  }

  const doctypeMatch = /^\s*<!doctype[^>]*>\s*/i.exec(source);
  const insertionIndex = doctypeMatch ? doctypeMatch[0].length : 0;
  return `${source.slice(0, insertionIndex)}${SANDBOXED_HTML_PREVIEW_BOOTSTRAP}${source.slice(
    insertionIndex,
  )}`;
}

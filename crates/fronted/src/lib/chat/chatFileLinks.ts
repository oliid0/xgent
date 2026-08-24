export type ChatFileLinkSource = "relative" | "absolute" | "file-url";

export type ChatFileLink = {
  path: string;
  source: ChatFileLinkSource;
  line?: number;
  endLine?: number;
  column?: number;
};

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

function decodeLinkPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseLocation(
  fragment: string,
): Pick<ChatFileLink, "line" | "endLine" | "column"> {
  const value = fragment.trim();
  let match = value.match(/^L?(\d+)(?:[-:]L?(\d+))?(?::?C(\d+))?$/i);
  if (!match) match = value.match(/^line-(\d+)(?:-(\d+))?(?:-column-(\d+))?$/i);
  if (!match) return {};
  const line = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : undefined;
  const column = match[3] ? Number(match[3]) : undefined;
  if (!Number.isSafeInteger(line) || line < 1) return {};
  return {
    line,
    ...(endLine && endLine >= line ? { endLine } : {}),
    ...(column && column >= 1 ? { column } : {}),
  };
}

function splitLocation(raw: string) {
  const hashIndex = raw.lastIndexOf("#");
  if (hashIndex > 0) {
    const location = parseLocation(raw.slice(hashIndex + 1));
    if (location.line) return { path: raw.slice(0, hashIndex), ...location };
  }
  const suffix = raw.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (suffix && suffix[1] && !/^[a-z]$/i.test(suffix[1])) {
    const line = Number(suffix[2]);
    const column = suffix[3] ? Number(suffix[3]) : undefined;
    return {
      path: suffix[1],
      line,
      ...(column ? { column } : {}),
    };
  }
  return { path: raw };
}

/** Returns null for web, mail, data and in-page links. */
export function parseChatFileLink(href: string | undefined): ChatFileLink | null {
  const raw = String(href ?? "").trim();
  if (!raw || raw.startsWith("#")) return null;

  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw);
      let path = decodeLinkPath(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (url.host && url.host !== "localhost") path = `//${url.host}${path}`;
      const location = parseLocation(url.hash.replace(/^#/, ""));
      return path ? { path, source: "file-url", ...location } : null;
    } catch {
      return null;
    }
  }
  if (EXTERNAL_SCHEME.test(raw) && !WINDOWS_ABSOLUTE.test(raw)) return null;

  const { path: rawPath, ...location } = splitLocation(raw);
  const path = decodeLinkPath(rawPath).trim();
  if (!path || path.includes("\0") || path.startsWith("?")) return null;
  const source: ChatFileLinkSource =
    WINDOWS_ABSOLUTE.test(path) || path.startsWith("/") || path.startsWith("~/")
      ? "absolute"
      : "relative";
  return { path, source, ...location };
}

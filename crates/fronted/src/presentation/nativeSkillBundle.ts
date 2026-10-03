/** System folders retain relative paths so scripts/assets travel with SKILL.md. */
export function decodeNativeSkillBundle(payload: string): File[] {
  const input: unknown = JSON.parse(payload);
  if (!Array.isArray(input) || input.length === 0 || input.length > 512)
    throw new Error("Invalid skill bundle selection");
  let total = 0;
  const seen = new Set<string>();
  return input.map((item) => {
    const path: string = typeof item?.path === "string" ? item.path.replace(/\\/g, "/") : "";
    const components = path.split("/");
    if (
      !path ||
      path.includes("\0") ||
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      components.some((part) => !part || part === "." || part === "..") ||
      seen.has(path)
    ) {
      throw new Error("Invalid skill bundle path");
    }
    seen.add(path);
    if (typeof item.contentBase64 !== "string" || item.contentBase64.length > 45 * 1024 * 1024)
      throw new Error("Invalid skill bundle data");
    const bytes = Uint8Array.from(atob(item.contentBase64), (value) => value.charCodeAt(0));
    total += bytes.length;
    if (total > 32 * 1024 * 1024) throw new Error("Skill bundle exceeds 32 MiB");
    const file = new File([bytes], components.at(-1)!, {
      type: typeof item.mimeType === "string" ? item.mimeType : "",
    });
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    return file;
  });
}

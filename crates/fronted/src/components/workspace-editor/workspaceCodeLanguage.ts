/** File language IDs shared by the Monaco and native workspace editors. */
export function workspaceCodeLanguage(path: string): string {
  const name = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  if (name === "cargo.lock") return "toml";
  if (name.endsWith(".d.ts")) return "typescript";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "py":
      return "python";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
      return "cpp";
    case "cs":
      return "csharp";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
    case "svg":
      return "xml";
    case "sql":
      return "sql";
    case "graphql":
    case "gql":
      return "graphql";
    default:
      return "plaintext";
  }
}

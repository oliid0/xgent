import { TokenizationRegistry } from "monaco-editor/editor/common/languages.js";
import { compile } from "monaco-editor/editor/standalone/common/monarch/monarchCompile.js";
import {
  MonarchTokenizer,
  type SyntaxProvider,
} from "monaco-editor/editor/standalone/common/monarch/monarchLexer.js";
import { language as cpp } from "monaco-editor/languages/definitions/cpp/cpp.js";
import { language as csharp } from "monaco-editor/languages/definitions/csharp/csharp.js";
import { language as css } from "monaco-editor/languages/definitions/css/css.js";
import { language as dockerfile } from "monaco-editor/languages/definitions/dockerfile/dockerfile.js";
import { language as go } from "monaco-editor/languages/definitions/go/go.js";
import { language as graphql } from "monaco-editor/languages/definitions/graphql/graphql.js";
import { language as html } from "monaco-editor/languages/definitions/html/html.js";
import { language as java } from "monaco-editor/languages/definitions/java/java.js";
import { language as javascript } from "monaco-editor/languages/definitions/javascript/javascript.js";
import { language as kotlin } from "monaco-editor/languages/definitions/kotlin/kotlin.js";
import { language as less } from "monaco-editor/languages/definitions/less/less.js";
import { language as markdown } from "monaco-editor/languages/definitions/markdown/markdown.js";
import { language as php } from "monaco-editor/languages/definitions/php/php.js";
import { language as python } from "monaco-editor/languages/definitions/python/python.js";
import { language as ruby } from "monaco-editor/languages/definitions/ruby/ruby.js";
import { language as rust } from "monaco-editor/languages/definitions/rust/rust.js";
import { language as scss } from "monaco-editor/languages/definitions/scss/scss.js";
import { language as shell } from "monaco-editor/languages/definitions/shell/shell.js";
import { language as sql } from "monaco-editor/languages/definitions/sql/sql.js";
import { language as swift } from "monaco-editor/languages/definitions/swift/swift.js";
import { language as typescript } from "monaco-editor/languages/definitions/typescript/typescript.js";
import { language as xml } from "monaco-editor/languages/definitions/xml/xml.js";
import { language as yaml } from "monaco-editor/languages/definitions/yaml/yaml.js";
import { createTokenizationSupport } from "monaco-editor/languages/features/json/tokenization.js";

const definitions: Record<string, unknown> = {
  c: cpp,
  cpp,
  csharp,
  css,
  dockerfile,
  go,
  graphql,
  html,
  java,
  javascript,
  kotlin,
  less,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
// These IDs live separately from Monaco's editor registrations. Loading a native
// grammar must never replace an existing editor/worker tokenization provider.
const prefix = "xgent-native-syntax/";
export const workspaceSyntaxLineLimit = 20_000;
const providers = new Map<string, SyntaxProvider>();
let initialized = false;
const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  "c++": "cpp",
  "c#": "csharp",
  rb: "ruby",
  htm: "html",
  xhtml: "html",
  gql: "graphql",
  yml: "yaml",
  "text/javascript": "javascript",
  "application/javascript": "javascript",
  "text/typescript": "typescript",
  "application/json": "json",
  "text/css": "css",
  "text/html": "html",
  "text/x-php": "php",
  "text/x-python": "python",
  "text/x-shellscript": "shell",
  "text/x-csrc": "c",
  "text/x-c++src": "cpp",
};
function resolve(value: string) {
  const id = aliases[value.toLowerCase()] ?? value.toLowerCase();
  return id === "json" || Object.hasOwn(definitions, id) ? `${prefix}${id}` : null;
}
function initialize() {
  if (initialized) return;
  initialized = true;
  const languageIds = ["json", ...Object.keys(definitions)];
  const service = {
    getLanguageIdByLanguageName: resolve,
    getLanguageIdByMimeType: resolve,
    isRegisteredLanguageId: (id: string) =>
      id.startsWith(prefix) && languageIds.includes(id.slice(prefix.length)),
    requestBasicLanguageFeatures: () => {},
    languageIdCodec: {
      encodeLanguageId: (id: string) => languageIds.indexOf(id.slice(prefix.length)) + 1,
    },
  };
  const configuration = {
    getValue: () => workspaceSyntaxLineLimit,
    onDidChangeConfiguration: () => ({ dispose() {} }),
  };
  const json = createTokenizationSupport(true);
  providers.set("json", {
    getInitialState: () => json.getInitialState(),
    tokenize(line, _hasEOL, state) {
      if (line.length >= workspaceSyntaxLineLimit) return { tokens: [], endState: state };
      const value = json.tokenize(line, state);
      return {
        tokens: value.tokens.map((token) => ({
          offset: token.startIndex,
          type: token.scopes,
          language: `${prefix}json`,
        })),
        endState: value.endState,
      };
    },
  });
  for (const [id, definition] of Object.entries(definitions)) {
    providers.set(
      id,
      new MonarchTokenizer(service, {}, `${prefix}${id}`, compile(id, definition), configuration),
    );
  }
  for (const [id, provider] of providers) TokenizationRegistry.register(`${prefix}${id}`, provider);
}
export function workspaceSyntaxProvider(languageId: string): SyntaxProvider | null {
  initialize();
  return providers.get(languageId) ?? null;
}

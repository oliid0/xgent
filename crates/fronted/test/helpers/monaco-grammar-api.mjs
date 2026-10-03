// Grammar `conf` objects use this exact editor enum. Import the common enum
// directly so headless lexical tests do not instantiate the browser API graph.
import { IndentAction } from "monaco-editor/editor/common/languages/languageConfiguration.js";
export const languages = { IndentAction };

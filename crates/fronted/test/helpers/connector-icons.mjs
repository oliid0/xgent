import React from "react";
import { readFileSync } from "node:fs";

// Same installed Lucide glyphs used by the application's icon imports.
const glyphs = JSON.parse(readFileSync(new URL("../../node_modules/@iconify-json/lucide/icons.json", import.meta.url), "utf8"));
export const connectorIcons = Object.fromEntries(Object.entries({ Calendar:"calendar", ContactRound:"contact-round", House:"house", LayoutGrid:"layout-grid", Lightbulb:"lightbulb", ListChecks:"list-checks", Sparkles:"sparkles" }).map(([key,name]) => [key, () => React.createElement("svg", { width:24, height:24, viewBox:"0 0 24 24", "aria-hidden":true, dangerouslySetInnerHTML:{ __html:glyphs.icons[name].body } })]));

import {
  CHAT_CODE_COLLAPSE_LINES,
  CHAT_CODE_MAX_HEIGHT,
  CHAT_CODE_VIEWPORT_FRACTION,
} from "../lib/readOnlyCode";
import type { PresentationNode } from "./types";

export function nativeReadOnlyCodeNodes(
  nodes: PresentationNode[],
  t: (key: string) => string,
): PresentationNode[] {
  const labels = {
    copy: t("chat.markdown.copyCode"),
    copied: t("chat.markdown.copied"),
    expand: t("chat.markdown.expandCode"),
    collapse: t("chat.markdown.collapseCode"),
    code: t("chat.markdown.code"),
    expandedState: t("chat.markdown.expanded"),
    collapsedState: t("chat.markdown.collapsed"),
  };
  const markdown = JSON.stringify({
    maxHeight: CHAT_CODE_MAX_HEIGHT,
    viewportFraction: CHAT_CODE_VIEWPORT_FRACTION,
    collapseLines: CHAT_CODE_COLLAPSE_LINES,
    hasLanguageLabel: true,
    container: "card",
    labels,
  });
  const visit = (node: PresentationNode): PresentationNode => {
    const children = node.children?.map(visit);
    if (node.kind === "Markdown") return { ...node, children, value: markdown };
    if (node.kind === "CodeBlock") {
      const argumentsBlock = node.id.endsWith(":arguments");
      const resultBlock = node.id.endsWith(":result");
      return {
        ...node,
        children,
        value: JSON.stringify({
          // Match the shared tool input/output/preview CSS limits (10/16/14rem).
          maxHeight: argumentsBlock ? 160 : resultBlock ? 256 : 224,
          hasLanguageLabel: false,
          container: argumentsBlock || resultBlock ? "section" : "card",
          labels,
        }),
      };
    }
    return children ? { ...node, children } : node;
  };
  return nodes.map(visit);
}

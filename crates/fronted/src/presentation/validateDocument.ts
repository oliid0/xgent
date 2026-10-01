import { presentationActionContracts, presentationNodeProperties } from "./protocol";
import type { PresentationDocument, PresentationHandler, PresentationNode } from "./types";

const NODE_KEYS = new Set<string>(["id", "kind", ...presentationNodeProperties]);
const STATUS = new Set(["pending", "running", "completed", "error", "paused"]);
const ROLE = new Set(["user", "assistant", "system"]);
const ALIGNMENT = new Set(["leading", "center", "trailing"]);
const SIZE = new Set(["small", "medium", "large"]);

function finiteInRange(value: number | undefined, minimum: number, maximum: number) {
  return value === undefined || (Number.isFinite(value) && value >= minimum && value <= maximum);
}

/** Reject invalid polyfill documents before they cross into SwiftUI. */
export function validatePresentationDocument(
  document: PresentationDocument,
  handlers: ReadonlyMap<string, PresentationHandler>,
) {
  if (document.version !== 1 || !document.surface || document.revision < 1) {
    throw new Error("Invalid native presentation envelope");
  }
  if (document.dismissAction && !handlers.has(document.dismissAction)) {
    throw new Error(`Missing native dismiss handler: ${document.dismissAction}`);
  }
  if (
    document.readingAction &&
    (document.mode !== "toast" || !handlers.has(document.readingAction))
  ) {
    throw new Error("Invalid native notification reading handler");
  }
  if (
    document.mode === "toast" &&
    !document.removed &&
    (!document.dismissAction || !document.readingAction)
  ) {
    throw new Error("Native notifications require dismissal and reading handlers");
  }
  if (document.mode === "toast" && !document.removed) {
    const message = document.nodes[0];
    if (
      document.nodes.length !== 1 ||
      message?.kind !== "Banner" ||
      message.variant !== "toast" ||
      typeof message.text !== "string" ||
      message.children?.length !== 1 ||
      message.children[0].kind !== "Button" ||
      message.children[0].action !== document.dismissAction
    ) {
      throw new Error("Invalid native notification content");
    }
  }
  if (document.mode === "status" && !document.removed) {
    const message = document.nodes[0];
    if (
      document.nodes.length !== 1 ||
      message?.kind !== "Banner" ||
      message.variant !== "service-status" ||
      typeof message.label !== "string" ||
      typeof message.text !== "string" ||
      !message.children?.length ||
      message.children.some((node) => node.kind !== "Button" || !node.action)
    ) {
      throw new Error("Invalid native service status content");
    }
  }
  if (!["root", "sheet", "alert", "sidebar", "panel", "toast", "status"].includes(document.mode)) {
    throw new Error("Invalid native presentation mode");
  }
  if (document.mode === "panel" && !document.removed) {
    const panel = document.workspacePanel;
    if (
      document.formFactor !== "desktop" ||
      !document.dismissAction ||
      !panel ||
      !Number.isSafeInteger(panel.focusRequest) ||
      panel.focusRequest < 0 ||
      [
        panel.openLabel,
        panel.returnLabel,
        panel.expandLabel,
        panel.restoreLabel,
        panel.closeLabel,
      ].some((label) => typeof label !== "string" || !label.trim())
    ) {
      throw new Error("Invalid native workspace panel");
    }
  }
  const ids = new Set<string>();
  const visit = (nodes: PresentationNode[], depth: number) => {
    if (depth >= 64 || ids.size + nodes.length > 20_000) {
      throw new Error("Native presentation tree exceeds its safety limit");
    }
    for (const node of nodes) {
      if (!node.id || ids.has(node.id)) throw new Error(`Duplicate native node: ${node.id}`);
      ids.add(node.id);
      const contract = presentationActionContracts[node.kind];
      if (!contract) throw new Error(`Unmapped native component: ${String(node.kind)}`);
      const unknown = Object.keys(node).find((key) => !NODE_KEYS.has(key));
      if (unknown) throw new Error(`Unmapped native property: ${node.kind}.${unknown}`);
      if (node.action) {
        if (contract.events.length === 0) {
          throw new Error(`Native component has no mapped event: ${node.kind}`);
        }
        if (!handlers.has(node.action))
          throw new Error(`Missing native action handler: ${node.action}`);
      }
      if (
        node.focusRequest !== undefined &&
        (node.kind !== "ComposerInput" ||
          !Number.isSafeInteger(node.focusRequest) ||
          node.focusRequest < 0)
      ) {
        throw new Error(`Invalid native focus request: ${node.id}`);
      }
      const dimensions = [
        node.spacing,
        node.padding,
        node.indent,
        node.width,
        node.minWidth,
        node.maxWidth,
        node.height,
        node.minHeight,
        node.maxHeight,
      ];
      if (dimensions.some((value) => !finiteInRange(value, 0, 10_000))) {
        throw new Error(`Invalid native dimension: ${node.id}`);
      }
      if (
        node.maxLines !== undefined &&
        (!Number.isInteger(node.maxLines) || !finiteInRange(node.maxLines, 1, 10_000))
      ) {
        throw new Error(`Invalid native line limit: ${node.id}`);
      }
      if (node.role && !ROLE.has(node.role)) throw new Error(`Invalid native role: ${node.id}`);
      if (node.status && !STATUS.has(node.status))
        throw new Error(`Invalid native status: ${node.id}`);
      if (node.alignment && !ALIGNMENT.has(node.alignment)) {
        throw new Error(`Invalid native alignment: ${node.id}`);
      }
      if (node.size && !SIZE.has(node.size)) throw new Error(`Invalid native size: ${node.id}`);
      if (node.minimum !== undefined && node.maximum !== undefined && node.minimum > node.maximum) {
        throw new Error(`Invalid native numeric range: ${node.id}`);
      }
      if (node.step !== undefined && (!Number.isFinite(node.step) || node.step <= 0)) {
        throw new Error(`Invalid native step: ${node.id}`);
      }
      if (
        node.kind === "NumberInput" &&
        (typeof node.value !== "number" ||
          !Number.isFinite(node.value) ||
          typeof node.minimum !== "number" ||
          !Number.isFinite(node.minimum) ||
          typeof node.maximum !== "number" ||
          !Number.isFinite(node.maximum) ||
          typeof node.step !== "number" ||
          !Number.isFinite(node.step) ||
          node.step <= 0 ||
          node.value < node.minimum ||
          node.value > node.maximum)
      )
        throw new Error(`Invalid native numeric input: ${node.id}`);
      if (node.total !== undefined && (!Number.isFinite(node.total) || node.total < 0)) {
        throw new Error(`Invalid native total: ${node.id}`);
      }
      if (node.options) {
        const values = new Set(node.options.map((option) => option.value));
        if (values.size !== node.options.length)
          throw new Error(`Duplicate native option: ${node.id}`);
      }
      visit(node.children ?? [], depth + 1);
    }
  };
  visit(document.nodes, 0);
}

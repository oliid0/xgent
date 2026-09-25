import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  type Placement,
  shift,
  size,
} from "@floating-ui/dom";

// Native CSS anchors are still inconsistent when their target is promoted to
// the Popover top layer (notably WebView2/WKWebView and nested dialogs). Keep
// every Astryx context layer on one measured geometry path. The pinned package
// patch supplies the real trigger and logical placement instead of guessing
// from DOM order.
export function needsLayerCompatibility(positioning?: string) {
  return typeof document !== "undefined" && positioning !== "custom";
}

const cleanups = new WeakMap<HTMLElement, () => void>();

export function stopCompatibleLayer(layer: HTMLElement | null) {
  if (!layer) return;
  cleanups.get(layer)?.();
  cleanups.delete(layer);
}

export function positionCompatibleLayer(layer: HTMLElement, anchor: HTMLElement | null) {
  stopCompatibleLayer(layer);
  delete layer.dataset.layerReady;
  if (
    !needsLayerCompatibility() ||
    !anchor?.isConnected ||
    !layer.dataset.layerPlacement ||
    layer.dataset.layerPositioning === "custom"
  )
    return;
  const side = layer.dataset.layerPlacement;
  const alignment = layer.dataset.layerAlignment;
  const rtl = getComputedStyle(anchor).direction === "rtl";
  const physical =
    side === "above"
      ? "top"
      : side === "below"
        ? "bottom"
        : side === "start"
          ? rtl
            ? "right"
            : "left"
          : rtl
            ? "left"
            : "right";
  const placement = `${physical}${alignment === "center" ? "" : `-${alignment}`}` as Placement;
  const computed = getComputedStyle(layer);
  const gap = Math.max(
    0,
    ...(side === "above" || side === "below"
      ? [computed.marginBlockStart, computed.marginBlockEnd]
      : [computed.marginInlineStart, computed.marginInlineEnd]
    ).map((value) => Number.parseFloat(value) || 0),
  );
  const previous = {
    position: layer.style.position,
    inset: layer.style.inset,
    margin: layer.style.margin,
    visibility: layer.style.visibility,
    maxWidth: layer.style.maxWidth,
    maxHeight: layer.style.maxHeight,
    width: layer.style.width,
    minWidth: layer.style.minWidth,
    positionAnchor: layer.style.getPropertyValue("position-anchor"),
    positionArea: layer.style.getPropertyValue("position-area"),
    positionTryFallbacks: layer.style.getPropertyValue("position-try-fallbacks"),
  };
  layer.style.setProperty("position-anchor", "auto");
  layer.style.setProperty("position-area", "none");
  layer.style.setProperty("position-try-fallbacks", "none");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "auto",
    left: "0px",
    top: "0px",
    margin: "0",
    visibility: "hidden",
  });
  // CSS anchor-size() no longer has an anchor after switching to measured
  // geometry. Size the outer surface too, rather than leaving a full-width
  // transparent wrapper around a compact selector's content.
  const selector = layer.querySelector(".astryx-selector-popup");
  const surface = layer.querySelector(".astryx-popover-surface");
  const composerExecutionMenu = Boolean(anchor.closest(".xgent-composer-execution-controls"));
  const compactWidth = composerExecutionMenu
    ? Math.min(448, Math.max(200, document.documentElement.clientWidth - 24))
    : Math.min(320, Math.max(200, anchor.getBoundingClientRect().width));
  if (selector) {
    layer.style.width = `${compactWidth}px`;
    layer.style.minWidth = "0";
  } else if (surface) {
    layer.style.width = "max-content";
    layer.style.minWidth = "0";
  }
  let active = true;
  const update = () => {
    void computePosition(anchor, layer, {
      strategy: "fixed",
      placement,
      middleware: [
        offset(gap),
        flip({ padding: 12 }),
        shift({ padding: 12 }),
        size({
          padding: 12,
          apply({ availableWidth, availableHeight }) {
            if (!active) return;
            layer.style.maxWidth = `${Math.max(0, availableWidth)}px`;
            layer.style.maxHeight = `${Math.max(0, availableHeight)}px`;
          },
        }),
      ],
    })
      .then(({ x, y, placement: resolvedPlacement }) => {
        if (active && layer.isConnected) {
          Object.assign(layer.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: previous.visibility,
          });
          layer.dataset.layerSide = resolvedPlacement.split("-")[0];
          layer.dataset.layerReady = "true";
        }
      })
      .catch((error) => {
        if (active) layer.style.visibility = previous.visibility;
        console.error("Unable to position application menu", error);
      });
  };
  const cleanup = autoUpdate(anchor, layer, update);
  const onToggle = (event: Event) => {
    if ((event as ToggleEvent).newState === "closed") stopCompatibleLayer(layer);
  };
  layer.addEventListener("toggle", onToggle);
  cleanups.set(layer, () => {
    active = false;
    delete layer.dataset.layerReady;
    cleanup();
    layer.removeEventListener("toggle", onToggle);
    Object.assign(layer.style, {
      position: previous.position,
      inset: previous.inset,
      margin: previous.margin,
      visibility: previous.visibility,
      maxWidth: previous.maxWidth,
      maxHeight: previous.maxHeight,
      width: previous.width,
      minWidth: previous.minWidth,
    });
    for (const [property, value] of [
      ["position-anchor", previous.positionAnchor],
      ["position-area", previous.positionArea],
      ["position-try-fallbacks", previous.positionTryFallbacks],
    ] as const) {
      if (value) layer.style.setProperty(property, value);
      else layer.style.removeProperty(property);
    }
  });
}

// The pinned Astryx patch reads this bridge only when mounting browser layers.
// Keeping installation in boot also leaves server-side component imports usable.
Object.assign(globalThis, {
  __xgentLayerCompatibility: {
    needsLayerCompatibility,
    positionCompatibleLayer,
    stopCompatibleLayer,
  },
});

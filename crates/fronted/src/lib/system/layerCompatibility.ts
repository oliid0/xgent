import { autoUpdate, computePosition, flip, type Placement, shift, size } from "@floating-ui/dom";

// Astryx 0.6.0 uses position-area and self-* alignment, beyond the Popover API
// shipped in Android WebView 124. The pinned dependency patch supplies the
// original trigger and logical placement instead of guessing from DOM order.
export function needsLayerCompatibility() {
  return !CSS.supports("position-area", "block-end span-self-inline-end");
}

const cleanups = new WeakMap<HTMLElement, () => void>();

export function stopCompatibleLayer(layer: HTMLElement | null) {
  if (!layer) return;
  cleanups.get(layer)?.();
  cleanups.delete(layer);
}

export function positionCompatibleLayer(layer: HTMLElement, anchor: HTMLElement | null) {
  stopCompatibleLayer(layer);
  if (!needsLayerCompatibility() || !anchor || !layer.dataset.layerPlacement) return;
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
  const previous = {
    position: layer.style.position,
    inset: layer.style.inset,
    margin: layer.style.margin,
    visibility: layer.style.visibility,
    maxWidth: layer.style.maxWidth,
    maxHeight: layer.style.maxHeight,
  };
  Object.assign(layer.style, {
    position: "fixed",
    inset: "auto",
    left: "0px",
    top: "0px",
    margin: "0",
    visibility: "hidden",
  });
  let active = true;
  const update = () => {
    void computePosition(anchor, layer, {
      strategy: "fixed",
      placement,
      middleware: [
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
      .then(({ x, y }) => {
        if (active && layer.isConnected)
          Object.assign(layer.style, {
            left: `${x}px`,
            top: `${y}px`,
            visibility: previous.visibility,
          });
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
    cleanup();
    layer.removeEventListener("toggle", onToggle);
    Object.assign(layer.style, previous);
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

# Astryx 0.6.3 layer compatibility

The unified Astryx frontend runs inside each non-Apple device's system WebView.
Astryx 0.6.3 requires the Popover API and CSS `position-area` with logical self alignment.
On older engines, closed menus/tooltips can enter normal layout and obscure
controls. Chromium 124 has Popover support but lacks the required positioning.

The boot entry installs OddBird's Popover polyfill and the application-owned
Floating UI bridge before loading React. This pinned patch supplies the bridge
with the real trigger, placement, mount and cleanup lifecycle. It does not
replace menu actions, focus handling, dismissal or application state. Supported
engines retain Astryx's native positioning.

Astryx's public `useLayer` documentation offers custom positioning for callers
that own a layer, but no application-wide fallback for its built-in components.
The CSS Anchor Positioning polyfill is not an equivalent drop-in replacement:
its documented limitations include dynamically added/removed anchors and targets,
and unsupported anchor properties assigned through React inline styles.

Astryx 0.6.3 retains its no-Popover fallback, but its built-in context layers
still use inline `positionArea`/`positionTryFallbacks` and do not provide an
application-wide geometry fallback. The exact-version patch is therefore still
required for the project's older supported Chromium/WebView engines.

Sources checked on 2026-09-28:

- Astryx MCP `get("Selector")` and `get("BottomSheet")`, the 0.6.3 npm package,
  and `dist/Layer/useLayer.js` from 0.6.0 and 0.6.3.
- https://github.com/oddbird/css-anchor-positioning#limitations
- https://github.com/oddbird/popover-polyfill
- https://floating-ui.com/docs/autoUpdate

Remove the patch and bridge when Astryx provides a tested fallback through its
public API. An upgrade must verify closed layers, menu positioning, dismissal,
settings navigation and touch input on an older supported WebView, including
menus inside dialogs. The exact-version patch intentionally requires review
when upgrading Astryx.

2026-09-27 interaction fixes: the compatibility portal must resolve a containing
`dialog` before `showModal()` adds its `open` attribute. Resolving only open
dialogs at initial mount sends settings menus to the inert body. BottomSheet's
Escape handler must also respect `defaultPrevented` when a child layer already
handled the key. Both failures were reproduced in Edge; the browser regression
fixture covers wide and compact settings presentations without changing styles.

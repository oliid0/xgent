/** Keep fixed mobile panels above the keyboard without changing pinch zoom. */
export function trackMobileViewport(view: Window, style: CSSStyleDeclaration) {
  const viewport = view.visualViewport;
  const update = () => {
    if (viewport && viewport.scale !== 1) return;
    style.setProperty("--xgent-viewport-height", `${viewport?.height ?? view.innerHeight}px`);
    style.setProperty("--xgent-viewport-top", `${viewport?.offsetTop ?? 0}px`);
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  view.addEventListener("resize", update);
  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    view.removeEventListener("resize", update);
    style.removeProperty("--xgent-viewport-height");
    style.removeProperty("--xgent-viewport-top");
  };
}

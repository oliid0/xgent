import { useEffect } from "react";

type EdgeSwipeNavigationOptions = {
  enabled: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onOpenLeft: () => void;
  onOpenRight: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  edgeWidthPx?: number;
  triggerDistancePx?: number;
};

type GestureIntent = "open-left" | "open-right" | "close-left" | "close-right";

type ActiveGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  intent: GestureIntent;
  horizontalLocked: boolean;
  cancelled: boolean;
};

const INTERACTIVE_GESTURE_EXCLUSIONS =
  "input, textarea, select, option, button, a, [contenteditable='true'], [data-edge-swipe-ignore], .xterm";

function closestElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function shouldIgnoreGestureStart(target: EventTarget | null) {
  return Boolean(closestElement(target)?.closest(INTERACTIVE_GESTURE_EXCLUSIONS));
}

function intentAtPointerDown(params: {
  clientX: number;
  viewportWidth: number;
  edgeWidthPx: number;
  target: EventTarget | null;
  leftOpen: boolean;
  rightOpen: boolean;
}): GestureIntent | null {
  const target = closestElement(params.target);

  if (params.leftOpen) {
    return target?.closest("[data-mobile-left-drawer]") ? "close-left" : null;
  }
  if (params.rightOpen) {
    return target?.closest("[data-mobile-right-drawer]") ? "close-right" : null;
  }
  if (params.clientX <= params.edgeWidthPx) return "open-left";
  if (params.clientX >= params.viewportWidth - params.edgeWidthPx) return "open-right";
  return null;
}

function intendedDistance(intent: GestureIntent, deltaX: number) {
  switch (intent) {
    case "open-left":
    case "close-right":
      return deltaX;
    case "open-right":
    case "close-left":
      return -deltaX;
  }
}

/**
 * Owns one horizontal edge gesture from pointer-down through pointer-up.
 *
 * Gesture ownership is decided only once at the start, so a diagonal drag can
 * never open both drawers. Vertical or interactive-control gestures are
 * released back to the page before they become horizontal navigation.
 */
export function useEdgeSwipeNavigation(options: EdgeSwipeNavigationOptions) {
  const {
    enabled,
    leftOpen,
    rightOpen,
    onOpenLeft,
    onOpenRight,
    onCloseLeft,
    onCloseRight,
    edgeWidthPx = 28,
    triggerDistancePx = 64,
  } = options;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let active: ActiveGesture | null = null;

    const clearGesture = (pointerId?: number) => {
      if (pointerId !== undefined && active?.pointerId !== pointerId) return;
      active = null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        active ||
        !event.isPrimary ||
        event.button !== 0 ||
        (event.pointerType && event.pointerType !== "touch" && event.pointerType !== "pen") ||
        shouldIgnoreGestureStart(event.target)
      ) {
        return;
      }

      const intent = intentAtPointerDown({
        clientX: event.clientX,
        viewportWidth: window.innerWidth,
        edgeWidthPx,
        target: event.target,
        leftOpen,
        rightOpen,
      });
      if (!intent) return;

      active = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        intent,
        horizontalLocked: false,
        cancelled: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = active;
      if (!gesture || gesture.pointerId !== event.pointerId || gesture.cancelled) return;

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!gesture.horizontalLocked) {
        if (absY >= 12 && absY > absX) {
          gesture.cancelled = true;
          return;
        }
        if (absX < 12) return;
        if (absX < absY * 1.2 || intendedDistance(gesture.intent, deltaX) <= 0) {
          gesture.cancelled = true;
          return;
        }
        gesture.horizontalLocked = true;
      }

      if (event.cancelable) event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = active;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const distance = intendedDistance(gesture.intent, event.clientX - gesture.startX);
      const shouldTrigger =
        !gesture.cancelled && gesture.horizontalLocked && distance >= triggerDistancePx;
      clearGesture(event.pointerId);
      if (!shouldTrigger) return;

      switch (gesture.intent) {
        case "open-left":
          onOpenLeft();
          break;
        case "open-right":
          onOpenRight();
          break;
        case "close-left":
          onCloseLeft();
          break;
        case "close-right":
          onCloseRight();
          break;
      }
    };

    const handlePointerCancel = (event: PointerEvent) => {
      clearGesture(event.pointerId);
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, { capture: true });
    window.addEventListener("pointercancel", handlePointerCancel, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", handlePointerCancel, { capture: true });
    };
  }, [
    edgeWidthPx,
    enabled,
    leftOpen,
    onCloseLeft,
    onCloseRight,
    onOpenLeft,
    onOpenRight,
    rightOpen,
    triggerDistancePx,
  ]);
}

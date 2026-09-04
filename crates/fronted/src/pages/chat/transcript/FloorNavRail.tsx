import { IconButton as AstryxIconButton } from "@astryxdesign/core/IconButton";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Pin } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  getFloorBookmarks,
  subscribeFloorBookmarks,
  toggleFloorBookmark,
} from "../../../lib/chat-floor-nav/floorBookmarks";
import {
  type FloorEntry,
  resolveNearestSampledRowKey,
  sampleFloorEntries,
} from "../../../lib/chat-floor-nav/floorModel";
import { cn } from "../../../lib/shared/utils";

const MIN_COLLAPSED_MARKERS = 8;
const MAX_COLLAPSED_MARKERS = 40;
const MAX_COLLAPSED_MARKERS_TOUCH = 12;

const MARKER_SLOT_PX = 9.5;
const BASE_MARKER_WIDTH_PX = 6;
const WAVE_MARKER_WIDTHS_PX = [26, 20, 14, 10] as const;
const PREVIEW_CARD_HALF_HEIGHT_PX = 56;

const COLLAPSE_DELAY_MS = 480;

const TOUCH_SCROLL_REVEAL_MS = 1400;

function useFloorBookmarks(conversationId: string): ReadonlySet<string> {
  const getSnapshot = useCallback(() => getFloorBookmarks(conversationId), [conversationId]);
  return useSyncExternalStore(subscribeFloorBookmarks, getSnapshot, getSnapshot);
}

function resolveMarkerWidth(markerIndex: number, hoveredMarkerIndex: number): number {
  if (hoveredMarkerIndex < 0) return BASE_MARKER_WIDTH_PX;
  return WAVE_MARKER_WIDTHS_PX[Math.abs(markerIndex - hoveredMarkerIndex)] ?? BASE_MARKER_WIDTH_PX;
}

export function FloorNavRail(props: {
  conversationId: string;
  floors: FloorEntry[];
  activeRowKey: string | null;
  bottomOffset?: string;
  scrollViewport?: HTMLElement | null;
  onJump: (rowKey: string) => void;
}) {
  const {
    conversationId,
    floors,
    activeRowKey,
    bottomOffset = "8px",
    scrollViewport = null,
    onJump,
  } = props;
  const { locale } = useLocale();
  const isEn = locale === "en-US";
  const bookmarks = useFloorBookmarks(conversationId);
  const [touchPanelOpen, setTouchPanelOpen] = useState(false);
  const [hoveredMarkerKey, setHoveredMarkerKey] = useState<string | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);

  const [navEl, setNavEl] = useState<HTMLElement | null>(null);

  const isCoarsePointer = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none), (pointer: coarse)").matches,
    [],
  );

  const [touchRevealed, setTouchRevealed] = useState(false);
  const revealTimerRef = useRef<number | null>(null);
  const touchPanelOpenRef = useRef(false);
  useEffect(() => {
    if (!isCoarsePointer || !scrollViewport) return;
    const handleScroll = () => {
      setTouchRevealed(true);
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
      revealTimerRef.current = window.setTimeout(() => {
        revealTimerRef.current = null;

        if (!touchPanelOpenRef.current) setTouchRevealed(false);
      }, TOUCH_SCROLL_REVEAL_MS);
    };
    scrollViewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollViewport.removeEventListener("scroll", handleScroll);
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, [isCoarsePointer, scrollViewport]);

  const maxMarkers = isCoarsePointer ? MAX_COLLAPSED_MARKERS_TOUCH : MAX_COLLAPSED_MARKERS;
  const [markerBudget, setMarkerBudget] = useState(maxMarkers);
  useLayoutEffect(() => {
    if (!navEl || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const budget = Math.floor((navEl.clientHeight - 24) / MARKER_SLOT_PX);
      setMarkerBudget(Math.max(MIN_COLLAPSED_MARKERS, Math.min(maxMarkers, budget)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(navEl);
    return () => observer.disconnect();
  }, [navEl, maxMarkers]);

  useLayoutEffect(() => {
    if (!touchPanelOpen) return;
    panelScrollRef.current
      ?.querySelector('[data-floor-active="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [touchPanelOpen]);

  const touchAutoHide = isCoarsePointer && scrollViewport !== null;

  useEffect(() => {
    touchPanelOpenRef.current = touchPanelOpen;
    if (!touchAutoHide) return;
    if (touchPanelOpen) {
      setTouchRevealed(true);
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      return;
    }
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = null;
      setTouchRevealed(false);
    }, TOUCH_SCROLL_REVEAL_MS);
    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, [touchPanelOpen, touchAutoHide]);

  const railVisible = !touchAutoHide || touchRevealed;

  const railLabel = isEn ? "Message navigation" : "消息导航";

  const pinnedTitle = isEn ? "Pinned" : "已置顶";
  const pinLabel = isEn ? "Pin" : "置顶";
  const unpinLabel = isEn ? "Unpin" : "取消置顶";

  const bookmarkedFloors = useMemo(
    () => floors.filter((floor) => bookmarks.has(floor.messageId)),
    [floors, bookmarks],
  );

  const collapsedMarkers = useMemo(() => {
    const mustKeep = new Set(bookmarkedFloors.map((floor) => floor.rowKey));
    return sampleFloorEntries(floors, markerBudget, mustKeep);
  }, [floors, bookmarkedFloors, markerBudget]);
  const activeMarkerKey = useMemo(
    () => resolveNearestSampledRowKey(floors, collapsedMarkers, activeRowKey),
    [floors, collapsedMarkers, activeRowKey],
  );
  const hoveredMarkerIndex = collapsedMarkers.findIndex(
    (floor) => floor.rowKey === hoveredMarkerKey,
  );
  const hoveredFloor = hoveredMarkerIndex >= 0 ? collapsedMarkers[hoveredMarkerIndex] : null;
  const previewCardOffset =
    hoveredMarkerIndex >= 0
      ? (hoveredMarkerIndex - (collapsedMarkers.length - 1) / 2) * MARKER_SLOT_PX
      : 0;
  const previewCardTop =
    hoveredMarkerIndex >= 0
      ? `clamp(${PREVIEW_CARD_HALF_HEIGHT_PX}px, calc(50% ${previewCardOffset < 0 ? "-" : "+"} ${Math.abs(previewCardOffset)}px), calc(100% - ${PREVIEW_CARD_HALF_HEIGHT_PX}px))`
      : "50%";

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const handleMarkerEnter = useCallback(
    (rowKey: string) => {
      if (isCoarsePointer) return;
      cancelCollapse();
      setHoveredMarkerKey(rowKey);
    },
    [cancelCollapse, isCoarsePointer],
  );

  const handlePreviewEnter = useCallback(() => {
    cancelCollapse();
  }, [cancelCollapse]);

  const handlePreviewLeave = useCallback(() => {
    if (isCoarsePointer) return;
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setHoveredMarkerKey(null);
    }, COLLAPSE_DELAY_MS);
  }, [cancelCollapse, isCoarsePointer]);

  useEffect(() => () => cancelCollapse(), [cancelCollapse]);

  useEffect(() => {
    if (!touchPanelOpen || !navEl) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && navEl.contains(event.target)) return;
      cancelCollapse();
      setTouchPanelOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [touchPanelOpen, navEl, cancelCollapse]);

  const handleJump = useCallback(
    (rowKey: string) => {
      onJump(rowKey);

      if (isCoarsePointer) {
        cancelCollapse();
        setTouchPanelOpen(false);
      }
    },
    [onJump, isCoarsePointer, cancelCollapse],
  );

  if (floors.length < 2) return null;
  if (isCoarsePointer) return null;

  const renderPanelRow = (floor: FloorEntry, isPinnedCopy = false) => {
    const isActive = floor.rowKey === activeRowKey;
    const isBookmarked = bookmarks.has(floor.messageId);
    return (
      <AstryxStack
        direction="horizontal"
        key={isPinnedCopy ? `pinned-${floor.rowKey}` : floor.rowKey}
        data-floor-active={(isActive && !isPinnedCopy) || undefined}
        className={cn(
          "group/floor flex items-center gap-1 rounded-lg pr-1 transition-colors",
          isActive ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]",
        )}
      >
        <button
          type="button"
          onClick={() => handleJump(floor.rowKey)}
          className={cn(
            "min-h-11 min-w-0 flex-1 truncate px-2 py-2 text-left text-[12px] leading-tight",
            isActive ? "font-medium text-foreground" : "text-muted-foreground",
          )}
          title={floor.preview}
        >
          {floor.preview}
        </button>
        <AstryxIconButton
          variant="ghost"
          size="sm"
          label={isBookmarked ? unpinLabel : pinLabel}
          tooltip={isBookmarked ? unpinLabel : pinLabel}
          onClick={() => toggleFloorBookmark(conversationId, floor.messageId)}
          className={cn(
            "h-11 w-11 shrink-0 rounded-md transition-all",
            isBookmarked
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground/50 opacity-0 hover:text-foreground group-hover/floor:opacity-100 focus-visible:opacity-100",

            isCoarsePointer && "opacity-100",
          )}
          icon={<Pin className={cn("h-3 w-3", isBookmarked && "fill-current")} />}
        />
      </AstryxStack>
    );
  };

  return (
    <AstryxStack
      direction="vertical"
      as="nav"
      ref={setNavEl}
      aria-label={railLabel}
      aria-hidden={!railVisible || undefined}
      className={cn(
        "pointer-events-none absolute right-4 top-2 z-10 flex items-center transition-opacity duration-200 @max-[280px]:hidden",
        railVisible ? "opacity-100" : "opacity-0",
      )}
      style={{ bottom: bottomOffset }}
      onMouseEnter={handlePreviewEnter}
      onMouseLeave={handlePreviewLeave}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        handlePreviewLeave();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        cancelCollapse();
        setHoveredMarkerKey(null);
      }}
    >
      {isCoarsePointer && touchPanelOpen ? (
        <AstryxStack
          direction="vertical"
          className={cn(
            "floor-nav-panel flex max-h-[min(78%,560px)] w-60 max-w-[calc(100cqw-2rem)] touch-manipulation flex-col overflow-hidden rounded-xl border border-border/50 bg-background/85 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.28)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.06]",

            railVisible ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <AstryxStack
            direction="vertical"
            ref={panelScrollRef}
            className="min-h-0 overflow-y-auto p-1.5"
          >
            {bookmarkedFloors.length > 0 ? (
              <AstryxStack
                direction="vertical"
                className="mb-1.5 rounded-lg bg-amber-500/[0.07] p-1 ring-1 ring-amber-500/20"
              >
                <AstryxStack
                  direction="horizontal"
                  className="flex items-center gap-1.5 px-1.5 pb-1 pt-0.5 text-[10.5px] font-medium text-amber-600/90 dark:text-amber-400/90"
                >
                  <Pin className="h-2.5 w-2.5 fill-current" />
                  {pinnedTitle}
                </AstryxStack>
                {bookmarkedFloors.map((floor) => renderPanelRow(floor, true))}
              </AstryxStack>
            ) : null}
            {floors.map((floor) => renderPanelRow(floor))}
          </AstryxStack>
        </AstryxStack>
      ) : (
        <AstryxStack
          direction="vertical"
          className={cn(
            "flex max-h-full touch-manipulation flex-col items-end gap-[7.5px] overflow-visible py-2 pl-2 pr-0.5",
            railVisible ? "pointer-events-auto" : "pointer-events-none",
          )}
          onTouchEnd={
            isCoarsePointer
              ? (event) => {
                  event.preventDefault();
                  cancelCollapse();
                  setTouchPanelOpen(true);
                }
              : undefined
          }
        >
          {collapsedMarkers.map((floor, markerIndex) => {
            const isActive = floor.rowKey === activeMarkerKey;
            const isBookmarked = bookmarks.has(floor.messageId);
            const isHovered = markerIndex === hoveredMarkerIndex;
            return (
              <button
                key={floor.rowKey}
                type="button"
                aria-label={floor.preview}
                aria-current={isActive ? "location" : undefined}
                onClick={() => handleJump(floor.rowKey)}
                onMouseEnter={() => handleMarkerEnter(floor.rowKey)}
                onFocus={() => handleMarkerEnter(floor.rowKey)}
                className={cn(
                  "relative h-0.5 rounded-full outline-none transition-[width,background-color,opacity] duration-150 ease-out after:absolute after:-inset-x-2 after:-inset-y-1 after:content-[''] motion-reduce:transition-none",
                  isBookmarked
                    ? "bg-amber-500/90"
                    : isHovered
                      ? "bg-foreground/90"
                      : isActive
                        ? "bg-foreground/60"
                        : "bg-foreground/[0.18]",
                )}
                style={{ width: resolveMarkerWidth(markerIndex, hoveredMarkerIndex) }}
              />
            );
          })}
        </AstryxStack>
      )}
      {!isCoarsePointer && hoveredFloor ? (
        <AstryxStack
          direction="horizontal"
          className="pointer-events-auto absolute z-20 w-80 max-w-[calc(100cqw-5rem)] -translate-y-1/2 items-start gap-1 rounded-xl border border-border/60 bg-background/92 p-2 shadow-[0_14px_40px_-20px_rgba(15,23,42,0.48)] backdrop-blur-xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none dark:border-white/[0.1] dark:bg-[#2a2a2a]/95"
          style={{
            top: previewCardTop,
            right: "calc(100% - 2px)",
          }}
          onPointerEnter={cancelCollapse}
          onPointerLeave={handlePreviewLeave}
        >
          <button
            type="button"
            onClick={() => handleJump(hoveredFloor.rowKey)}
            className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06]"
          >
            <span className="block truncate text-[13px] font-medium leading-5 text-foreground">
              {hoveredFloor.preview}
            </span>
            {hoveredFloor.responsePreview ? (
              <span className="mt-1 block line-clamp-3 text-[12px] leading-[1.55] text-muted-foreground">
                {hoveredFloor.responsePreview}
              </span>
            ) : null}
          </button>
          <AstryxIconButton
            variant="ghost"
            size="sm"
            label={bookmarks.has(hoveredFloor.messageId) ? unpinLabel : pinLabel}
            tooltip={bookmarks.has(hoveredFloor.messageId) ? unpinLabel : pinLabel}
            onClick={() => toggleFloorBookmark(conversationId, hoveredFloor.messageId)}
            className={cn(
              "mt-1 shrink-0",
              bookmarks.has(hoveredFloor.messageId)
                ? "text-amber-500 hover:bg-amber-500/10"
                : "text-muted-foreground/50 hover:bg-foreground/[0.05] hover:text-foreground",
            )}
            icon={
              <Pin
                className={cn(
                  "h-3.5 w-3.5",
                  bookmarks.has(hoveredFloor.messageId) && "fill-current",
                )}
              />
            }
          />
        </AstryxStack>
      ) : null}
    </AstryxStack>
  );
}

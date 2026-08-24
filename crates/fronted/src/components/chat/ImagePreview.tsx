import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { useLocale } from "../../i18n";
import { Copy, Download, ExternalLink, Loader2 } from "../icons";
import "yet-another-react-lightbox/styles.css";

export type ImagePreviewSlide = {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  onPrepare?: () => Promise<void> | void;
  onCopy?: () => Promise<void> | void;
  onSave?: () => Promise<unknown> | void;
  onOpen?: () => Promise<void> | void;
};

type ImagePreviewProps = {
  open: boolean;
  slides: ImagePreviewSlide[];
  index?: number;
  closeLabel?: string;
  onClose: () => void;
};

const imagePreviewPlugins = [Zoom];

function normalizeImagePreviewIndex(index: number | undefined) {
  return Number.isFinite(index) ? Math.trunc(index as number) : 0;
}

function clampImagePreviewIndex(index: number, slideCount: number) {
  if (slideCount <= 0) return 0;
  return Math.min(Math.max(index, 0), slideCount - 1);
}

export const ImagePreview = memo(function ImagePreview(props: ImagePreviewProps) {
  const { t } = useLocale();
  const { open, slides, index = 0, closeLabel = "关闭预览", onClose } = props;
  const requestedIndex = normalizeImagePreviewIndex(index);
  const clampedRequestedIndex = clampImagePreviewIndex(requestedIndex, slides.length);
  const [activeIndex, setActiveIndex] = useState(clampedRequestedIndex);
  const [pendingAction, setPendingAction] = useState<"copy" | "save" | "open" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const wasOpenRef = useRef(open);
  const requestedIndexRef = useRef(requestedIndex);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    const requestedIndexChanged = requestedIndexRef.current !== requestedIndex;
    requestedIndexRef.current = requestedIndex;

    if (!open) {
      wasOpenRef.current = false;
      setActiveIndex(clampedRequestedIndex);
      return;
    }

    if (!wasOpen || requestedIndexChanged) {
      setActiveIndex(clampedRequestedIndex);
    }
    wasOpenRef.current = true;
  }, [clampedRequestedIndex, open, requestedIndex]);

  useEffect(() => {
    setActiveIndex((currentIndex) => clampImagePreviewIndex(currentIndex, slides.length));
  }, [slides.length]);

  const clampedIndex = clampImagePreviewIndex(activeIndex, slides.length);
  const activeSlide = slides[clampedIndex];

  useEffect(() => {
    setActionError(null);
    setPendingAction(null);
    if (!open || !activeSlide?.onPrepare) return;
    void Promise.resolve(activeSlide.onPrepare()).catch(() => {
      // Preparation is an optimization. Copy retries and reports real errors.
    });
  }, [activeSlide, open]);

  const handleView = useCallback(
    ({ index: nextIndex }: { index: number }) => {
      setActiveIndex(clampImagePreviewIndex(nextIndex, slides.length));
    },
    [slides.length],
  );

  const callbacks = useMemo(
    () => ({
      view: handleView,
    }),
    [handleView],
  );

  if (slides.length === 0) return null;

  const singleSlideRender =
    slides.length > 1
      ? undefined
      : {
          buttonPrev: () => null,
          buttonNext: () => null,
        };

  const runAction = async (
    action: "copy" | "save" | "open",
    handler: (() => Promise<unknown> | void) | undefined,
  ) => {
    if (!handler || pendingAction) return;
    setPendingAction(action);
    setActionError(null);
    try {
      await handler();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  };

  const hasActions = Boolean(activeSlide?.onCopy || activeSlide?.onSave || activeSlide?.onOpen);

  return (
    <>
      <Lightbox
        open={open}
        close={onClose}
        index={clampedIndex}
        slides={slides}
        on={callbacks}
        plugins={imagePreviewPlugins}
        labels={{
          Close: closeLabel,
          Next: t("chat.image.next"),
          Previous: t("chat.image.previous"),
        }}
        carousel={{
          finite: true,
          imageFit: "contain",
        }}
        controller={{
          aria: true,
          closeOnBackdropClick: true,
        }}
        render={singleSlideRender}
        zoom={{
          maxZoomPixelRatio: 3,
          scrollToZoom: true,
        }}
        styles={{
          container: {
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(8px)",
          },
        }}
      />
      {open && hasActions ? (
        <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+0.75rem)] left-1/2 z-[10001] flex max-w-[calc(100vw-8rem)] -translate-x-1/2 flex-col items-center gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/15 bg-black/55 p-1 text-white shadow-xl backdrop-blur-xl">
            {activeSlide?.onCopy ? (
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors hover:bg-white/15 disabled:opacity-60"
                disabled={pendingAction !== null}
                onClick={() => void runAction("copy", activeSlide.onCopy)}
                aria-label={t("chat.image.copy")}
                title={t("chat.image.copy")}
              >
                {pendingAction === "copy" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{t("chat.image.copy")}</span>
              </button>
            ) : null}
            {activeSlide?.onSave ? (
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors hover:bg-white/15 disabled:opacity-60"
                disabled={pendingAction !== null}
                onClick={() => void runAction("save", activeSlide.onSave)}
                aria-label={t("chat.image.save")}
                title={t("chat.image.save")}
              >
                {pendingAction === "save" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{t("chat.image.save")}</span>
              </button>
            ) : null}
            {activeSlide?.onOpen ? (
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors hover:bg-white/15 disabled:opacity-60"
                disabled={pendingAction !== null}
                onClick={() => void runAction("open", activeSlide.onOpen)}
                aria-label={t("chat.image.openSystem")}
                title={t("chat.image.openSystem")}
              >
                {pendingAction === "open" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{t("chat.image.openSystem")}</span>
              </button>
            ) : null}
          </div>
          {actionError ? (
            <div
              role="status"
              className="pointer-events-auto max-w-[min(28rem,calc(100vw-2rem))] rounded-lg bg-red-950/85 px-3 py-2 text-center text-xs text-red-100 shadow-xl"
            >
              {actionError}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
});

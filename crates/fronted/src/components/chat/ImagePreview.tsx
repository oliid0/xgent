import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { Center } from "@astryxdesign/core/Center";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  VStack,
} from "@astryxdesign/core/Layout";
import { Slider } from "@astryxdesign/core/Slider";
import { Text } from "@astryxdesign/core/Text";
import { memo, useCallback, useEffect, useRef, useState, type WheelEvent } from "react";

import { useLocale } from "../../i18n";
import { ArrowLeft, ChevronRight, Copy, Download, ExternalLink, X } from "../icons";

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

function normalizeImagePreviewIndex(index: number | undefined) {
  return Number.isFinite(index) ? Math.trunc(index as number) : 0;
}

function clampImagePreviewIndex(index: number, slideCount: number) {
  if (slideCount <= 0) return 0;
  return Math.min(Math.max(index, 0), slideCount - 1);
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, 1), 3);
}

export const ImagePreview = memo(function ImagePreview(props: ImagePreviewProps) {
  const { t } = useLocale();
  const { open, slides, index = 0, closeLabel = "关闭预览", onClose } = props;
  const requestedIndex = normalizeImagePreviewIndex(index);
  const clampedRequestedIndex = clampImagePreviewIndex(requestedIndex, slides.length);
  const [activeIndex, setActiveIndex] = useState(clampedRequestedIndex);
  const [zoom, setZoom] = useState(1);
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
    setZoom(1);
    setActionError(null);
    setPendingAction(null);
    if (!open || !activeSlide?.onPrepare) return;
    void Promise.resolve(activeSlide.onPrepare()).catch(() => {
      // Preparation is an optimization. Copy retries and reports real errors.
    });
  }, [activeSlide, open]);

  const changeSlide = useCallback(
    (nextIndex: number) => {
      setActiveIndex(clampImagePreviewIndex(nextIndex, slides.length));
    },
    [slides.length],
  );

  if (slides.length === 0) return null;

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

  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((current) => clampZoom(current + direction * 0.1));
  };

  const dialogTitle = activeSlide?.title || activeSlide?.alt || t("chat.image.preview");
  const positionLabel = `${clampedIndex + 1} / ${slides.length}`;

  const actionButtons = (
    <ButtonGroup size="sm">
      {activeSlide?.onCopy ? (
        <Button
          label={t("chat.image.copy")}
          tooltip={t("chat.image.copy")}
          icon={<Icon icon={Copy} size="sm" color="inherit" />}
          variant="ghost"
          isLoading={pendingAction === "copy"}
          isDisabled={pendingAction !== null && pendingAction !== "copy"}
          onClick={() => void runAction("copy", activeSlide.onCopy)}
        />
      ) : null}
      {activeSlide?.onSave ? (
        <Button
          label={t("chat.image.save")}
          tooltip={t("chat.image.save")}
          icon={<Icon icon={Download} size="sm" color="inherit" />}
          variant="ghost"
          isLoading={pendingAction === "save"}
          isDisabled={pendingAction !== null && pendingAction !== "save"}
          onClick={() => void runAction("save", activeSlide.onSave)}
        />
      ) : null}
      {activeSlide?.onOpen ? (
        <Button
          label={t("chat.image.openSystem")}
          tooltip={t("chat.image.openSystem")}
          icon={<Icon icon={ExternalLink} size="sm" color="inherit" />}
          variant="ghost"
          isLoading={pendingAction === "open"}
          isDisabled={pendingAction !== null && pendingAction !== "open"}
          onClick={() => void runAction("open", activeSlide.onOpen)}
        />
      ) : null}
    </ButtonGroup>
  );

  return (
    <Dialog
      isOpen={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      variant="fullscreen"
      purpose="info"
      padding={0}
    >
      <Layout
        defaultHasDividers
        header={
          <DialogHeader
            title={dialogTitle}
            subtitle={slides.length > 1 ? positionLabel : undefined}
            endContent={
              <HStack gap={2} vAlign="center">
                {actionButtons}
                <IconButton
                  label={closeLabel}
                  tooltip={closeLabel}
                  icon={<Icon icon={X} size="sm" color="inherit" />}
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                />
              </HStack>
            }
          />
        }
        content={
          <LayoutContent padding={0} isScrollable>
            <VStack height="100%" gap={0}>
              {actionError ? (
                <Banner status="error" title={actionError} container="section" />
              ) : null}
              <Center
                onWheel={handleWheel}
                style={{
                  minHeight: "var(--xagent-image-preview-stage-min-height)",
                  flex: 1,
                  overflow: "auto",
                  backgroundColor: "var(--color-background-inverted)",
                  touchAction: "pan-x pan-y pinch-zoom",
                }}
              >
                <img
                  src={activeSlide.src}
                  alt={activeSlide.alt ?? dialogTitle}
                  width={activeSlide.width}
                  height={activeSlide.height}
                  draggable={false}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "var(--xagent-image-preview-max-height)",
                    objectFit: "contain",
                    transform: `scale(${zoom})`,
                    transformOrigin: "center",
                    transitionProperty: "transform",
                    transitionDuration: "var(--duration-fast)",
                    transitionTimingFunction: "var(--ease-standard)",
                  }}
                />
              </Center>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter padding={3}>
            <HStack gap={3} vAlign="center" hAlign="center" wrap="wrap">
              <IconButton
                label={t("chat.image.previous")}
                tooltip={t("chat.image.previous")}
                icon={<Icon icon={ArrowLeft} size="sm" color="inherit" />}
                size="sm"
                variant="ghost"
                isDisabled={clampedIndex <= 0}
                onClick={() => changeSlide(clampedIndex - 1)}
              />
              <Slider
                label={t("chat.image.zoom")}
                isLabelHidden
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                valueDisplay="text"
                width="min(40vw, var(--xagent-image-preview-slider-max-width))"
                formatValue={(value) => `${Math.round(value * 100)}%`}
                onChange={(value) => {
                  if (typeof value === "number") setZoom(value);
                }}
              />
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {positionLabel}
              </Text>
              <IconButton
                label={t("chat.image.next")}
                tooltip={t("chat.image.next")}
                icon={<Icon icon={ChevronRight} size="sm" color="inherit" />}
                size="sm"
                variant="ghost"
                isDisabled={clampedIndex >= slides.length - 1}
                onClick={() => changeSlide(clampedIndex + 1)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
});

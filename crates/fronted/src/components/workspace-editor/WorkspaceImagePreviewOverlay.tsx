import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "../../i18n";
import { invokeFs } from "../../lib/tools/fsBackend";
import { ImageIcon, ImageOff, RefreshCw, X } from "../icons";
import { MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";

export type WorkspaceImagePreviewOpenRequest = {
  id: number;
  projectPathKey: string;
  workdir: string;
  path: string;
};

type ReadWorkspaceImageResponse = {
  path: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
};

type WorkspaceImagePreviewOverlayProps = {
  openRequest: WorkspaceImagePreviewOpenRequest | null;
  isOpen: boolean;
  onRequestClose: () => void;
  onClose: () => void;
};

const IMAGE_PREVIEW_OVERLAY_ANIMATION_MS = 200;

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const text = String(error ?? "").trim();
  return text || fallback;
}

export function WorkspaceImagePreviewOverlay(props: WorkspaceImagePreviewOverlayProps) {
  const { openRequest, isOpen, onRequestClose, onClose } = props;
  const { t } = useLocale();
  const closeAnimationTimeoutRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);
  const [image, setImage] = useState<ReadWorkspaceImageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
        closeAnimationTimeoutRef.current = null;
      }
      const animationFrame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(animationFrame);
    }

    setIsVisible(false);
    closeAnimationTimeoutRef.current = window.setTimeout(() => {
      closeAnimationTimeoutRef.current = null;
      onClose();
    }, IMAGE_PREVIEW_OVERLAY_ANIMATION_MS);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
      }
    },
    [],
  );

  const loadImage = useCallback(
    async (request: WorkspaceImagePreviewOpenRequest) => {
      const sequence = loadSequenceRef.current + 1;
      loadSequenceRef.current = sequence;
      setLoading(true);
      setError(null);
      setImage(null);
      try {
        const response = await invokeFs<ReadWorkspaceImageResponse>("fs_read_workspace_image", {
          workdir: request.workdir,
          path: request.path,
        });
        if (loadSequenceRef.current !== sequence) return;
        setImage(response);
      } catch (loadError) {
        if (loadSequenceRef.current !== sequence) return;
        setImage(null);
        setError(toMessage(loadError, t("workspaceImagePreview.openFailed")));
      } finally {
        if (loadSequenceRef.current === sequence) {
          setLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (!openRequest) return;
    void loadImage(openRequest);
  }, [loadImage, openRequest]);

  const source = image ? `data:${image.mimeType};base64,${image.data}` : "";
  const activePath = image?.path ?? openRequest?.path ?? "";

  return (
    <VStack
      className="xagent-workspace-preview-overlay"
      data-visible={isVisible ? "true" : "false"}
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--xagent-z-workspace-overlay)",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        backgroundColor: "var(--color-background-body)",
        borderInlineEnd: "var(--border-width) solid var(--color-border)",
      }}
    >
      <MacOsTitleBarSpacer />
      <Layout
        height="100%"
        header={
          <LayoutHeader hasDivider padding={3}>
            <HStack gap={2} vAlign="center">
              <Icon icon={ImageIcon} size="sm" color="accent" />
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={4}>{t("workspaceImagePreview.title")}</Heading>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {activePath}
                  </Text>
                </VStack>
              </StackItem>
              <IconButton
                label={t("workspaceImagePreview.reload")}
                tooltip={t("workspaceImagePreview.reload")}
                icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                size="sm"
                variant="ghost"
                isLoading={loading}
                isDisabled={!openRequest}
                onClick={() => openRequest && void loadImage(openRequest)}
              />
              <IconButton
                label={t("workspaceImagePreview.close")}
                tooltip={t("workspaceImagePreview.close")}
                icon={<Icon icon={X} size="sm" color="inherit" />}
                size="sm"
                variant="ghost"
                onClick={onRequestClose}
              />
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable>
            <VStack height="100%" gap={0}>
              {error ? (
                <Banner
                  status="error"
                  title={t("workspaceImagePreview.openFailed")}
                  description={error}
                  container="section"
                  collapsible={false}
                />
              ) : null}
              <Center
                style={{
                  minHeight: "var(--xagent-workspace-image-stage-min-height)",
                  flex: 1,
                  overflow: "auto",
                  backgroundColor: "var(--color-background-muted)",
                }}
              >
                {loading ? (
                  <Spinner size="lg" label={t("workspaceImagePreview.loading")} />
                ) : source ? (
                  <img
                    src={source}
                    alt={basename(activePath)}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                ) : (
                  <EmptyState
                    title={t("workspaceImagePreview.empty")}
                    icon={<Icon icon={ImageOff} size="lg" color="secondary" />}
                    isCompact
                  />
                )}
              </Center>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider padding={2}>
            <HStack gap={3} vAlign="center" hAlign="between">
              <StackItem size="fill">
                <Text type="supporting" color="secondary" maxLines={1}>
                  {activePath}
                </Text>
              </StackItem>
              {image ? (
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {image.mimeType} · {formatBytes(image.sizeBytes)}
                </Text>
              ) : null}
            </HStack>
          </LayoutFooter>
        }
      />
    </VStack>
  );
}

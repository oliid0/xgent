import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Folder, FolderOpen } from "../../components/icons";
import { useLocale } from "../../i18n";
import type { MobileExecutionBackend } from "../../lib/mobileExecution";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import type { PresentationNode, PresentationTheme } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { MobileFullscreenPanel, MobilePanelHeader } from "../chat/mobile/MobilePanelScaffold";
import { SettingsModalShell } from "./SettingsModalShell";

type FileEntry = { path: string; kind: string; hidden: boolean };
type FileList = { entries: FileEntry[]; hasMore: boolean; total: number };
type FileStatus = { kind: string | null; sizeBytes: number | null };
type FileRead = { kind: string; content: string | null; truncated: boolean | null };

const pageSize = 100;
const previewLimitBytes = 1024 * 1024;

function pathParts(path: string) {
  return path.split("/").filter(Boolean);
}

function entryName(path: string) {
  return pathParts(path).at(-1) ?? path;
}

function sortEntries(entries: FileEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return entryName(left.path).localeCompare(entryName(right.path));
  });
}

export function MobileEnvironmentBrowser(props: {
  rootPath: string;
  backend: MobileExecutionBackend;
  open?: boolean;
  onClose?: () => void;
  nativeSettingsSurfaceId?: string;
  appearance?: "system" | "light" | "dark";
  theme?: PresentationTheme;
}) {
  const { rootPath, backend } = props;
  const { t } = useLocale();
  const [localOpen, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const open = props.open ?? localOpen;
  const [directory, setDirectory] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [previewPath, setPreviewPath] = useState("");
  const [preview, setPreview] = useState<FileRead | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const requestId = useRef(0);
  const previewId = useRef(0);
  const scope = useRef({ open, rootPath, directory });
  scope.current = { open, rootPath, directory };
  const isCurrent = () =>
    scope.current.open &&
    scope.current.rootPath === rootPath &&
    scope.current.directory === directory;

  const close = useCallback(() => {
    requestId.current += 1;
    previewId.current += 1;
    scope.current.open = false;
    setOpen(false);
    props.onClose?.();
  }, [props.onClose]);

  useEffect(() => setDirectory(""), [rootPath]);
  useEffect(() => {
    scope.current.open = open;
    return () => {
      scope.current.open = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !rootPath) return;
    const currentRequest = ++requestId.current;
    setEntries([]);
    setHasMore(false);
    setLoadingMore(false);
    previewId.current += 1;
    setPreviewPath("");
    setPreview(null);
    setPreviewLoading(false);
    setError("");
    setLoading(true);
    void invoke<FileList>("fs_list", {
      workdir: rootPath,
      path: directory || null,
      depth: 1,
      offset: 0,
      max_results: pageSize,
      show_hidden: true,
    })
      .then((result) => {
        if (currentRequest !== requestId.current) return;
        setEntries(sortEntries(result.entries));
        setHasMore(result.hasMore);
      })
      .catch((cause) => {
        if (currentRequest === requestId.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
    return () => {
      requestId.current += 1;
      previewId.current += 1;
    };
  }, [open, rootPath, directory, reloadKey]);

  async function loadMore() {
    if (!isCurrent() || loading || loadingMore || !hasMore) return;
    const currentRequest = ++requestId.current;
    setLoadingMore(true);
    setError("");
    try {
      const result = await invoke<FileList>("fs_list", {
        workdir: rootPath,
        path: directory || null,
        depth: 1,
        offset: entries.length,
        max_results: pageSize,
        show_hidden: true,
      });
      if (currentRequest !== requestId.current) return;
      setEntries((current) => sortEntries([...current, ...result.entries]));
      setHasMore(result.hasMore);
    } catch (cause) {
      if (currentRequest === requestId.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  }

  async function openFile(path: string) {
    if (!isCurrent()) return;
    const currentPreview = ++previewId.current;
    setPreviewPath(path);
    setPreview(null);
    setError("");
    setPreviewLoading(true);
    try {
      const status = await invoke<FileStatus>("fs_path_status", { workdir: rootPath, path });
      if (currentPreview !== previewId.current) return;
      if (
        status.kind !== "file" ||
        status.sizeBytes == null ||
        status.sizeBytes > previewLimitBytes
      ) {
        throw new Error(t("settings.mobileFilesPreviewUnavailable"));
      }
      const result = await invoke<FileRead>("fs_read_text", {
        workdir: rootPath,
        path,
        start_line: 1,
        limit: 120,
      });
      if (currentPreview !== previewId.current) return;
      if (result.kind !== "text" || result.content == null) {
        throw new Error(t("settings.mobileFilesPreviewUnavailable"));
      }
      setPreview(result);
    } catch (cause) {
      if (currentPreview === previewId.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (currentPreview === previewId.current) setPreviewLoading(false);
    }
  }

  const parts = pathParts(directory);
  const firstVisiblePart = Math.max(0, parts.length - 3);
  const rootLabel = backend === "android-proot" ? "Alpine /" : "a-Shell";
  function navigate(path: string) {
    if (!isCurrent() || path === directory) return;
    requestId.current += 1;
    previewId.current += 1;
    scope.current.directory = path;
    setDirectory(path);
  }
  function backToList() {
    previewId.current += 1;
    setPreviewPath("");
    setPreview(null);
    setPreviewLoading(false);
    setError("");
  }

  if (isApplePresentationRuntime()) {
    if (!open) return null;
    const c = presentationControls();
    const pathNode = c.select(
      "shell-files-directory",
      t("settings.mobileFilesPath"),
      directory,
      [
        { value: "", label: rootLabel },
        ...parts.map((part, index) => ({
          value: parts.slice(0, index + 1).join("/"),
          label: part,
        })),
      ],
      navigate,
    );
    const content: PresentationNode[] = [];
    if (error)
      content.push({ id: "shell-files-error", kind: "Banner", label: error, status: "error" });
    if (previewPath) {
      content.push(c.action("shell-files-list", t("settings.mobileFilesBack"), backToList));
      content.push({ id: "shell-files-name", kind: "Heading", text: entryName(previewPath) });
      if (previewLoading)
        content.push({
          id: "shell-files-loading",
          kind: "Progress",
          label: t("settings.mobileFilesLoading"),
        });
      if (preview) {
        content.push({
          id: "shell-files-preview",
          kind: "CodeBlock",
          text: preview.content ?? "",
          language: "plaintext",
          wrap: true,
        });
        if (preview.truncated)
          content.push({
            id: "shell-files-truncated",
            kind: "Text",
            text: t("settings.mobileFilesTruncated"),
            secondary: true,
          });
      }
    } else if (loading) {
      content.push({
        id: "shell-files-loading",
        kind: "Progress",
        label: t("settings.mobileFilesLoading"),
      });
    } else {
      if (!entries.length && !error)
        content.push({
          id: "shell-files-empty",
          kind: "EmptyState",
          label: t("settings.mobileFilesEmpty"),
        });
      content.push({
        id: "shell-files-entries",
        kind: "List",
        children: entries.map((entry) => ({
          ...c.action(`shell-files-entry:${entry.path}`, entryName(entry.path), () =>
            entry.kind === "dir" ? navigate(entry.path) : openFile(entry.path),
          ),
          kind: "NavigationRow",
          icon: entry.kind === "dir" ? "folder" : "doc.text",
        })),
      });
      if (hasMore)
        content.push(
          c.action("shell-files-more", t("settings.mobileFilesMore"), loadMore, !loadingMore),
        );
      if (loadingMore)
        content.push({
          id: "shell-files-more-loading",
          kind: "Progress",
          label: t("settings.mobileFilesLoading"),
        });
    }
    return (
      <NativeSurface
        sessionSurface={props.nativeSettingsSurfaceId}
        document={{
          mode: "sheet",
          title: t("settings.mobileFilesTitle"),
          appearance: props.appearance ?? "system",
          theme: props.theme,
          formFactor: "mobile",
          dismissAction: "shell-files-close",
          nodes: [
            { ...c.action("shell-files-close", t("settings.mobileFilesClose"), close), id: "back" },
            pathNode,
            {
              id: "shell-files-path",
              kind: "Text",
              text: `${rootLabel}${directory ? ` / ${directory}` : ""}`,
              secondary: true,
              maxLines: 2,
            },
            c.action(
              "shell-files-refresh",
              t("settings.mobileRefresh"),
              () => {
                if (isCurrent()) setReloadKey((value) => value + 1);
              },
              !loading && !loadingMore,
            ),
            ...content,
          ],
        }}
        handlers={c.handlers}
        onError={(cause) => setError(String(cause))}
      />
    );
  }

  return (
    <>
      <Button
        type="button"
        label={t("settings.mobileFilesBrowse")}
        variant="secondary"
        icon={<FolderOpen />}
        onClick={(event) => {
          // A body portal is below an open native dialog's top layer, regardless
          // of z-index. Keep the destination in the settings dialog that owns it.
          setPortalTarget(event.currentTarget.closest("dialog") ?? document.body);
          setDirectory("");
          setOpen(true);
        }}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <div style={{ position: "relative", zIndex: 1100 }}>
              <SettingsModalShell onClose={close} ariaLabel={t("settings.mobileFilesTitle")}>
                <MobileFullscreenPanel open label={t("settings.mobileFilesTitle")} onBack={close}>
                  <MobilePanelHeader
                    title={t("settings.mobileFilesTitle")}
                    subtitle={rootLabel}
                    onBack={close}
                    backLabel={t("settings.mobileFilesClose")}
                    actions={
                      <Button
                        label={t("settings.mobileRefresh")}
                        variant="secondary"
                        isDisabled={loading || loadingMore}
                        onClick={() => setReloadKey((value) => value + 1)}
                      />
                    }
                  />
                  <VStack gap={2} padding={3} className="min-h-0 shrink-0 overflow-x-auto">
                    <Breadcrumbs label={t("settings.mobileFilesPath")} variant="supporting">
                      <BreadcrumbItem
                        isCurrent={parts.length === 0}
                        onClick={parts.length ? () => navigate("") : undefined}
                      >
                        {rootLabel}
                      </BreadcrumbItem>
                      {firstVisiblePart > 0 ? (
                        <BreadcrumbItem
                          onClick={() => navigate(parts.slice(0, firstVisiblePart).join("/"))}
                        >
                          …
                        </BreadcrumbItem>
                      ) : null}
                      {parts.slice(firstVisiblePart).map((part, index) => {
                        const depth = firstVisiblePart + index + 1;
                        return (
                          <BreadcrumbItem
                            key={depth}
                            isCurrent={depth === parts.length}
                            onClick={
                              depth < parts.length
                                ? () => navigate(parts.slice(0, depth).join("/"))
                                : undefined
                            }
                          >
                            {part}
                          </BreadcrumbItem>
                        );
                      })}
                    </Breadcrumbs>
                  </VStack>
                  <StackItem size="fill" isScrollable className="min-h-0">
                    <VStack gap={3} padding={3}>
                      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
                      {previewPath ? (
                        <VStack gap={3}>
                          <HStack gap={2} vAlign="center" wrap="wrap">
                            <Button
                              type="button"
                              label={t("settings.mobileFilesBack")}
                              variant="secondary"
                              onClick={backToList}
                            />
                            <Text type="body" weight="medium" wordBreak="break-word">
                              {entryName(previewPath)}
                            </Text>
                          </HStack>
                          {previewLoading ? (
                            <Spinner aria-label={t("settings.mobileFilesLoading")} />
                          ) : null}
                          {preview ? (
                            <>
                              <CodeBlock
                                code={preview.content ?? ""}
                                language="plaintext"
                                title={entryName(previewPath)}
                                size="sm"
                                isWrapped
                                width="100%"
                              />
                              {preview.truncated ? (
                                <Text type="supporting" color="secondary">
                                  {t("settings.mobileFilesTruncated")}
                                </Text>
                              ) : null}
                            </>
                          ) : null}
                        </VStack>
                      ) : loading ? (
                        <Spinner aria-label={t("settings.mobileFilesLoading")} />
                      ) : entries.length === 0 && !error ? (
                        <EmptyState title={t("settings.mobileFilesEmpty")} isCompact />
                      ) : (
                        <VStack gap={3}>
                          <List
                            density="compact"
                            hasDividers
                            header={t("settings.mobileFilesTitle")}
                          >
                            {entries.map((entry) => (
                              <ListItem
                                key={entry.path}
                                label={entryName(entry.path)}
                                description={entry.kind === "dir" ? undefined : entry.path}
                                startContent={entry.kind === "dir" ? <Folder /> : <FileText />}
                                onClick={() =>
                                  entry.kind === "dir"
                                    ? navigate(entry.path)
                                    : void openFile(entry.path)
                                }
                              />
                            ))}
                          </List>
                          {hasMore ? (
                            <Button
                              type="button"
                              label={t("settings.mobileFilesMore")}
                              isLoading={loadingMore}
                              isDisabled={loadingMore}
                              onClick={() => void loadMore()}
                            />
                          ) : null}
                        </VStack>
                      )}
                    </VStack>
                  </StackItem>
                </MobileFullscreenPanel>
              </SettingsModalShell>
            </div>,
            portalTarget ?? document.body,
          )
        : null}
    </>
  );
}

import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { memo, useEffect, useId, useMemo, useState } from "react";

import { useLocale } from "../../i18n";
import type { ChangedFilesSummary } from "../../lib/chat/messages/changedFiles";
import { invokeFs } from "../../lib/tools/fsBackend";
import { FileText } from "../icons";
import { WorkspaceMarkdownPreview } from "../workspace-editor/WorkspaceMarkdownPreview";
import { buildSandboxedHtmlPreviewSource } from "../workspace-editor/workspaceHtmlPreview";
import { getWorkspacePreviewKind } from "../workspace-editor/workspaceImagePreview";
import { getFileTypeIcon } from "./fileTypeIcons";

type ReadWorkspacePreviewResponse = {
  path: string;
  data: string;
};

type PreviewState =
  | { status: "loading"; path: string; kind: "html" | "markdown" }
  | { status: "loaded"; path: string; kind: "html" | "markdown"; content: string }
  | { status: "error"; path: string; kind: "html" | "markdown"; message: string };

function decodeBase64Text(data: string) {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function previewLanguage(path: string, kind: "html" | "markdown") {
  if (kind === "html") return "html";
  return path.toLowerCase().endsWith(".mdx") ? "mdx" : "markdown";
}

export const GeneratedFilePreviewCard = memo(function GeneratedFilePreviewCard(props: {
  summary: ChangedFilesSummary;
  workdir: string;
}) {
  const { summary, workdir } = props;
  const { t } = useLocale();
  const tabsId = useId();
  const previewPanelId = `${tabsId}-preview`;
  const sourcePanelId = `${tabsId}-source`;
  const target = useMemo(() => {
    for (let index = summary.files.length - 1; index >= 0; index -= 1) {
      const file = summary.files[index];
      if (!file || file.deleted) continue;
      const kind = getWorkspacePreviewKind(file.path);
      if (kind === "html" || kind === "markdown") {
        return { path: file.path, kind } as const;
      }
    }
    return null;
  }, [summary.files]);
  const [activeTab, setActiveTab] = useState<"preview" | "source">("preview");
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!target || !workdir.trim()) {
      setState(null);
      return;
    }
    let cancelled = false;
    setActiveTab("preview");
    setState({ status: "loading", ...target });
    void invokeFs<ReadWorkspacePreviewResponse>("fs_read_workspace_image", {
      workdir,
      path: target.path,
    })
      .then((response) => {
        if (cancelled) return;
        setState({
          status: "loaded",
          path: response.path || target.path,
          kind: target.kind,
          content: decodeBase64Text(response.data),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          ...target,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [target, workdir]);

  if (!target || !state) return null;

  const FileIcon = getFileTypeIcon(state.path, "file");
  return (
    <Card padding={0} elevation="low">
      <VStack gap={0} width="100%">
        <Toolbar
          label={basename(state.path)}
          size="sm"
          startContent={
            <HStack gap={2} vAlign="center">
              <Icon icon={FileIcon ?? FileText} size="sm" color="accent" />
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={4}>{basename(state.path)}</Heading>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {state.path}
                  </Text>
                </VStack>
              </StackItem>
            </HStack>
          }
          endContent={
            <TabList
              value={activeTab}
              onChange={(value) => setActiveTab(value === "source" ? "source" : "preview")}
              role="tablist"
              size="sm"
              overflow="auto"
            >
              <Tab
                value="preview"
                label={t("workspaceFilePreview.preview")}
                panelId={previewPanelId}
              />
              <Tab
                value="source"
                label={t("workspaceFilePreview.source")}
                panelId={sourcePanelId}
              />
            </TabList>
          }
        />
        {state.status === "loading" ? (
          <VStack height={64} hAlign="center" vAlign="center">
            <Spinner size="md" label={t("workspaceFilePreview.loading")} />
          </VStack>
        ) : state.status === "error" ? (
          <Banner
            status="error"
            title={t("workspaceFilePreview.openFailed")}
            description={state.message}
            collapsible={false}
          />
        ) : activeTab === "source" ? (
          <div id={sourcePanelId} role="tabpanel">
            <CodeBlock
              code={state.content}
              language={previewLanguage(state.path, state.kind)}
              title={basename(state.path)}
              hasCopyButton
              hasLineNumbers
              width="100%"
              maxHeight={480}
              container="section"
            />
          </div>
        ) : state.kind === "html" ? (
          <div id={previewPanelId} role="tabpanel">
            <iframe
              style={{
                display: "block",
                width: "100%",
                minHeight: 420,
                aspectRatio: "16 / 10",
                border: 0,
                backgroundColor: "white",
              }}
              sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups"
              srcDoc={buildSandboxedHtmlPreviewSource(state.content)}
              title={basename(state.path)}
            />
          </div>
        ) : (
          <VStack
            id={previewPanelId}
            role="tabpanel"
            width="100%"
            padding={4}
            style={{ maxHeight: 520, overflow: "auto", background: "var(--color-background-body)" }}
          >
            <WorkspaceMarkdownPreview
              workdir={workdir}
              markdownPath={state.path}
              content={state.content}
              className="text-sm leading-6"
            />
          </VStack>
        )}
      </VStack>
    </Card>
  );
});

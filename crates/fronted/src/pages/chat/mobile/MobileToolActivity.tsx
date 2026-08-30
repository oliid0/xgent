import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { ChatToolCalls } from "@astryxdesign/core/Chat";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useMemo, useSyncExternalStore } from "react";
import { AdaptiveDialog } from "../../../components/astryx/AdaptiveDialog";
import { Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type {
  LiveTranscriptState,
  LiveTranscriptStore,
} from "../../../lib/chat/conversation/liveTranscriptStore";
import {
  safeStringify,
  summarizeToolCall,
  type ToolTraceItem,
  toolResultMessageToText,
} from "../../../lib/chat/messages/uiMessages";

type MobileToolActivityProps = {
  store: LiveTranscriptStore;
  open: boolean;
  onOpen: () => void;
  onOpenBrowser?: () => void;
  onOpenTerminal?: () => void;
  onClose: () => void;
  bottomOffsetPx: number;
};

type ActivityItem = ToolTraceItem & {
  running: boolean;
  round: number;
};

function subscribeNoop() {
  return () => {};
}

const EMPTY_TRANSCRIPT: LiveTranscriptState = {
  draftAssistantText: "",
  toolStatus: null,
  liveRounds: [],
  retryAttempts: [],
  isSettled: true,
};

function collectActivityItems(snapshot: LiveTranscriptState): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const round of snapshot.liveRounds) {
    const runningIds = new Set(round.runningToolCallIds);
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      items.push({
        ...block.item,
        running: runningIds.has(block.item.toolCall.id),
        round: round.round,
      });
    }
  }
  return items;
}

function activityKind(name: string): "shell" | "browser" | "tool" {
  const normalized = name.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "shell";
  }
  if (
    normalized.includes("browser") ||
    normalized.includes("websearch") ||
    normalized.includes("web_search")
  ) {
    return "browser";
  }
  return "tool";
}

function toolOutput(item: ActivityItem) {
  if (!item.toolResult) return "";
  const output = toolResultMessageToText(item.toolResult);
  return output.trim();
}

function toolFailed(result: ToolResultMessage | undefined) {
  return Boolean(result && "isError" in result && result.isError);
}

export function MobileToolActivity({
  store,
  open,
  onOpen,
  onOpenBrowser,
  onOpenTerminal,
  onClose,
  bottomOffsetPx,
}: MobileToolActivityProps) {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNoop,
    store?.getSnapshot ?? (() => EMPTY_TRANSCRIPT),
    () => EMPTY_TRANSCRIPT,
  );
  const items = useMemo(() => collectActivityItems(snapshot), [snapshot]);
  const activeItem = [...items].reverse().find((item) => item.running) ?? null;
  const latestItem = items.at(-1) ?? null;
  const capsuleItem = activeItem;
  const status = snapshot.toolStatus?.trim() || "";
  const capsuleTitle = capsuleItem?.toolCall.name || t("chat.mobileActivity.working");
  const capsuleDetail = capsuleItem
    ? summarizeToolCall(capsuleItem.toolCall, { includeName: false }) || status
    : status;
  const toolCalls = [...items].reverse().map((item) => {
    const output = toolOutput(item);
    const failed = toolFailed(item.toolResult);
    return {
      key: item.toolCall.id,
      name: item.toolCall.name,
      target:
        summarizeToolCall(item.toolCall, { includeName: false }) ||
        t("chat.mobileActivity.noArguments"),
      node: t("chat.mobileActivity.round").replace("{round}", String(item.round)),
      status: item.running
        ? ("running" as const)
        : failed
          ? ("error" as const)
          : ("complete" as const),
      errorMessage: failed && output ? output : undefined,
      resultDetail: (
        <VStack gap={3}>
          <Text type="label" color="secondary">
            {t("chat.mobileActivity.input")}
          </Text>
          <CodeBlock
            code={safeStringify(item.toolCall.arguments || {})}
            language="json"
            size="sm"
            width="100%"
            maxHeight="var(--xagent-tool-input-max-height)"
            isWrapped
            container="section"
          />
          {output ? (
            <>
              <Text type="label" color="secondary">
                {t("chat.mobileActivity.output")}
              </Text>
              <CodeBlock
                code={output}
                language="plaintext"
                size="sm"
                width="100%"
                maxHeight="var(--xagent-tool-output-max-height)"
                isWrapped
                container="section"
              />
            </>
          ) : null}
        </VStack>
      ),
    };
  });

  return (
    <>
      {capsuleItem || status ? (
        <HStack
          hAlign="center"
          width="100%"
          paddingInline={5}
          className="pointer-events-none absolute inset-x-0 z-30"
          style={{ bottom: `calc(${Math.max(0, bottomOffsetPx)}px + var(--spacing-2))` }}
        >
          <Button
            label={capsuleTitle}
            tooltip={capsuleDetail || capsuleTitle}
            variant="secondary"
            size="sm"
            elevation="high"
            width="var(--xagent-mobile-activity-width)"
            onClick={() => {
              const kind = capsuleItem ? activityKind(capsuleItem.toolCall.name) : "tool";
              if (kind === "browser" && onOpenBrowser) {
                onOpenBrowser();
                return;
              }
              if (kind === "shell" && onOpenTerminal) {
                onOpenTerminal();
                return;
              }
              onOpen();
            }}
            className="pointer-events-auto"
          />
        </HStack>
      ) : null}

      <AdaptiveDialog
        isOpen={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        title={t("chat.mobileActivity.title")}
        subtitle={activeItem ? t("chat.mobileActivity.running") : t("chat.mobileActivity.recent")}
        purpose="info"
        presentation="fullscreen"
      >
        <VStack gap={4}>
          {toolCalls.length > 0 ? (
            <ChatToolCalls
              calls={toolCalls}
              label={t("chat.mobileActivity.title")}
              defaultIsExpanded
            />
          ) : (
            <EmptyState
              icon={<Wrench />}
              title={t("chat.mobileActivity.empty")}
              description={t("chat.mobileActivity.emptyDescription")}
            />
          )}
          {!activeItem && latestItem && status ? (
            <Banner status="info" title={status} collapsible={false} />
          ) : null}
        </VStack>
      </AdaptiveDialog>
    </>
  );
}

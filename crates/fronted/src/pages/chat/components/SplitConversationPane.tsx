import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useRef } from "react";

import { X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { ChatFileLink } from "../../../lib/chat/chatFileLinks";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import type { ChatHistoryRecord } from "../../../lib/chat/history/chatHistory";
import type { ScrollFollowHandle } from "../../../lib/chat-scroll/useScrollFollow";
import { ChatTranscript } from "../transcript/ChatTranscript";

const resolveNoEarlierHistory = () => Promise.resolve();
const ignoreResend = () => undefined;
const ignoreSettings = () => undefined;

export type SplitConversationPaneProps = {
  width: number | string;
  conversationId: string;
  record: ChatHistoryRecord | null;
  loading: boolean;
  error: string | null;
  liveTranscriptStore: LiveTranscriptStore;
  isRunning: boolean;
  isAgentMode: boolean;
  showUsage: boolean;
  onOpenFileLink?: (link: ChatFileLink) => void;
  onActivate: () => void;
  onRetry: () => void;
  onClose: () => void;
};

export function SplitConversationPane(props: SplitConversationPaneProps) {
  const { t } = useLocale();
  const followRef = useRef<ScrollFollowHandle | null>(null);
  const title = props.record?.title || t("chat.pendingTitle");
  const historyItems = props.record?.state.transcript.items ?? [];

  return (
    <VStack
      width={props.width}
      height="100%"
      minHeight={0}
      gap={0}
      style={{ flexShrink: 0, minWidth: 0 }}
      aria-label={t("chat.split.paneLabel").replace("{title}", title)}
    >
      <Toolbar
        label={t("chat.split.toolbar")}
        size="sm"
        dividers={["bottom"]}
        startContent={
          <Heading level={3} maxLines={1}>
            {title}
          </Heading>
        }
        endContent={
          <HStack gap={1} vAlign="center">
            <Button
              label={t("chat.split.continueHere")}
              size="sm"
              variant="ghost"
              isDisabled={props.loading || !props.record}
              onClick={props.onActivate}
            />
            <IconButton
              label={t("chat.split.close")}
              tooltip={t("chat.split.close")}
              size="sm"
              variant="ghost"
              icon={<Icon icon={X} size="sm" color="inherit" />}
              onClick={props.onClose}
            />
          </HStack>
        }
      />

      {props.loading ? (
        <Center width="100%" style={{ flex: 1 }}>
          <Spinner label={t("chat.split.loading")} />
        </Center>
      ) : props.error ? (
        <Center width="100%" style={{ flex: 1 }}>
          <Banner
            status="error"
            title={t("chat.split.loadFailed")}
            description={props.error}
            endContent={<Button label={t("chat.split.retry")} size="sm" onClick={props.onRetry} />}
          />
        </Center>
      ) : props.record && historyItems.length > 0 ? (
        <ChatTranscript
          conversationId={props.conversationId}
          workspaceRoot={props.record.cwd}
          followRef={followRef}
          hasModels
          historyItems={historyItems}
          hasMoreHistory={false}
          onLoadEarlierHistory={resolveNoEarlierHistory}
          isHistorySwitching={false}
          isSending={props.isRunning}
          isAgentMode={props.isAgentMode}
          showUsage={props.showUsage}
          liveTranscriptStore={props.liveTranscriptStore}
          isCompactionRunning={false}
          isReadOnly
          onOpenFileLink={props.onOpenFileLink}
          onResendFromEdit={ignoreResend}
          onOpenSettings={ignoreSettings}
        />
      ) : (
        <Center width="100%" style={{ flex: 1 }}>
          <Banner status="info" title={t("chat.split.empty")} container="section" />
        </Center>
      )}
    </VStack>
  );
}

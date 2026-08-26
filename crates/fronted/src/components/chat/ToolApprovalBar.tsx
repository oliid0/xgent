import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import type {
  PendingToolApprovalSummary,
  ToolApprovalDecision,
} from "../../lib/tools/toolApproval";
import { Shield } from "../icons";

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function ToolApprovalBar(props: {
  pending: PendingToolApprovalSummary[];
  onDecide: (
    toolCallId: string,
    decision: ToolApprovalDecision,
  ) => Promise<{ ok: boolean; message?: string }>;
  onDecideAll: (decision: "approve" | "deny") => Promise<void>;
}) {
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const earliestDeadline = useMemo(
    () =>
      props.pending.length > 0
        ? Math.min(...props.pending.map((item) => item.deadlineAt))
        : Date.now(),
    [props.pending],
  );
  const [remainingMs, setRemainingMs] = useState(() => earliestDeadline - Date.now());

  useEffect(() => {
    const update = () => setRemainingMs(earliestDeadline - Date.now());
    update();
    const timer = globalThis.setInterval(update, 1000);
    return () => globalThis.clearInterval(timer);
  }, [earliestDeadline]);

  if (props.pending.length === 0) return null;

  const guarded = async (task: () => Promise<{ ok: boolean; message?: string } | void>) => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const outcome = await task();
      if (outcome && !outcome.ok) setError(outcome.message || t("chat.toolApproval.failed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.toolApproval.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Section
      padding={3}
      width="calc(100% - var(--spacing-6))"
      maxWidth="var(--xagent-content-width-lg)"
      dividers={["top", "start", "end"]}
      className="mx-auto overflow-hidden backdrop-blur-2xl"
    >
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Shield />
          <StackItem size="fill">
            <Text type="label" maxLines={1}>
              {t("chat.toolApproval.title").replace("{count}", String(props.pending.length))}
            </Text>
          </StackItem>
          <Badge label={String(props.pending.length)} variant="warning" />
          <Token label={formatCountdown(remainingMs)} color="orange" size="sm" />
        </HStack>
        {props.pending.length > 1 ? (
          <HStack gap={2} wrap="wrap">
            <Button
              type="button"
              label={t("chat.toolApproval.approveAll")}
              variant="primary"
              size="sm"
              isDisabled={submitting}
              onClick={() => void guarded(() => props.onDecideAll("approve"))}
            />
            <Button
              type="button"
              label={t("chat.toolApproval.denyAll")}
              variant="destructive"
              size="sm"
              isDisabled={submitting}
              onClick={() => void guarded(() => props.onDecideAll("deny"))}
            />
          </HStack>
        ) : null}
        <List density="compact" hasDividers>
          {props.pending.map((item) => (
            <ListItem
              key={item.toolCallId}
              label={item.toolName}
              description={
                item.summary ? (
                  <CodeBlock
                    code={item.summary}
                    language="plaintext"
                    size="sm"
                    maxHeight="var(--xagent-approval-summary-max-height)"
                    width="100%"
                    isWrapped
                    container="section"
                  />
                ) : undefined
              }
              endContent={
                <HStack gap={1} wrap="wrap" hAlign="end">
                  <Button
                    type="button"
                    label={t("chat.toolApproval.approve")}
                    variant="primary"
                    size="sm"
                    isDisabled={submitting}
                    onClick={() => void guarded(() => props.onDecide(item.toolCallId, "approve"))}
                  />
                  <Button
                    type="button"
                    label={t("chat.toolApproval.approveSession")}
                    variant="secondary"
                    size="sm"
                    isDisabled={submitting}
                    onClick={() =>
                      void guarded(() => props.onDecide(item.toolCallId, "approve_session"))
                    }
                  />
                  <Button
                    type="button"
                    label={t("chat.toolApproval.deny")}
                    variant="destructive"
                    size="sm"
                    isDisabled={submitting}
                    onClick={() => void guarded(() => props.onDecide(item.toolCallId, "deny"))}
                  />
                </HStack>
              }
            />
          ))}
        </List>
        {error ? <Banner status="error" title={error} collapsible={false} /> : null}
      </VStack>
    </Section>
  );
}

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { TextArea } from "@astryxdesign/core/TextArea";
import { memo, useEffect, useRef, useState } from "react";

import { useLocale } from "../../../i18n";
import type { PendingUploadedFile } from "../../../lib/chat/messages/uploadedFiles";
import { UserAttachmentCards } from "./UserAttachmentCards";

export const EditableUserMessageBubble = memo(function EditableUserMessageBubble(props: {
  initialText: string;
  attachments: PendingUploadedFile[];
  workspaceRoot?: string;
  compactedClass: string;
  onCancel: () => void;
  onSubmit: (text: string, attachments: PendingUploadedFile[]) => void;
}) {
  const { initialText, attachments, workspaceRoot, compactedClass, onCancel, onSubmit } = props;
  const { t } = useLocale();
  const [draftText, setDraftText] = useState(initialText);
  const [draftAttachments, setDraftAttachments] = useState(attachments);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const viewport = textarea.closest<HTMLDivElement>("[data-scroll-viewport]");
    const scrollTopBeforeFocus = viewport?.scrollTop ?? null;
    const restoreViewportScroll = () => {
      if (viewport && scrollTopBeforeFocus !== null) {
        viewport.scrollTop = scrollTopBeforeFocus;
      }
    };

    textarea.focus({ preventScroll: true });
    const cursorPosition = textarea.value.length;
    textarea.setSelectionRange(cursorPosition, cursorPosition);
    restoreViewportScroll();

    const rafId = requestAnimationFrame(restoreViewportScroll);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    setDraftAttachments(attachments);
  }, [attachments]);

  const canSubmit = draftText.trim().length > 0 || draftAttachments.length > 0;

  return (
    <Card
      width="100%"
      maxWidth="min(85%, calc(var(--xagent-chat-measure) + var(--spacing-10)))"
      padding={3}
      variant="muted"
      className={compactedClass}
    >
      <VStack gap={2}>
        <UserAttachmentCards
          files={draftAttachments}
          workspaceRoot={workspaceRoot}
          onRemove={(relativePath) => {
            setDraftAttachments((prev) =>
              prev.filter((file) => file.relativePath !== relativePath),
            );
          }}
        />
        <TextArea
          ref={textareaRef}
          label={t("chat.editMessage")}
          isLabelHidden
          value={draftText}
          onChange={setDraftText}
          rows={Math.max(2, draftText.split("\n").length)}
          width="100%"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onCancel();
            }
          }}
        />
        <HStack gap={2} hAlign="end">
          <Button type="button" label={t("chat.cancel")} variant="secondary" onClick={onCancel} />
          <Button
            type="button"
            label={t("chat.send")}
            variant="primary"
            isDisabled={!canSubmit}
            onClick={() => {
              const newText = draftText.trim();
              if (!canSubmit) return;
              onSubmit(newText, draftAttachments);
            }}
          />
        </HStack>
      </VStack>
    </Card>
  );
});

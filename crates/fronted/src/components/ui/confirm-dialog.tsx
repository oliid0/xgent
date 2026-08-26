import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import {
  Children,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type ConfirmDialogTone = "warning" | "destructive";

export type ConfirmDialogOptions = {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  detail?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  tone?: ConfirmDialogTone;
};

type PendingConfirmDialog = ConfirmDialogOptions & {
  resolve: (confirmed: boolean) => void;
};

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(" ").trim();
  if (isValidElement<{ children?: ReactNode }>(node)) return getNodeText(node.props.children);
  return Children.toArray(node).map(getNodeText).join(" ").trim();
}

function ConfirmDialog(
  props: ConfirmDialogOptions & { onCancel: () => void; onConfirm: () => void },
) {
  const {
    title,
    subtitle,
    description,
    detail,
    confirmLabel,
    cancelLabel,
    tone = "destructive",
    onCancel,
    onConfirm,
  } = props;
  const titleText = getNodeText(title);
  const descriptionText = [subtitle, description, detail]
    .map(getNodeText)
    .filter(Boolean)
    .join("\n\n");

  return (
    <AlertDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
      title={titleText}
      description={descriptionText || titleText}
      cancelLabel={cancelLabel}
      actionLabel={confirmLabel}
      actionVariant={tone === "destructive" ? "destructive" : "primary"}
      onAction={onConfirm}
    />
  );
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirmDialog | null>(null);
  const pendingRef = useRef<PendingConfirmDialog | null>(null);

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(confirmed);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      subtitle={pending.subtitle}
      description={pending.description}
      detail={pending.detail}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      closeLabel={pending.closeLabel}
      tone={pending.tone}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}

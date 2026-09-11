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
import { NativeSurface } from "../../presentation/NativeSurface";
import type { PresentationHandler } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";

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

  if (isApplePresentationRuntime()) {
    return (
      <NativeConfirmDialog
        title={titleText}
        description={descriptionText || titleText}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={tone === "destructive"}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

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

function NativeConfirmDialog(props: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [failure, setFailure] = useState<unknown>(null);
  if (failure) throw failure;
  const handlers = new Map<string, PresentationHandler>([
    ["confirm", { enabled: true, accepts: (value) => value === null, run: props.onConfirm }],
    ["cancel", { enabled: true, accepts: (value) => value === null, run: props.onCancel }],
  ]);
  return (
    <NativeSurface
      document={{
        mode: "alert",
        title: props.title,
        appearance: "system",
        dismissAction: "cancel",
        nodes: [
          { id: "description", kind: "Text", text: props.description },
          {
            id: "confirm",
            kind: "Button",
            label: props.confirmLabel,
            destructive: props.destructive,
            action: "confirm",
          },
          { id: "cancel", kind: "Button", label: props.cancelLabel, action: "cancel" },
        ],
      }}
      handlers={handlers}
      onError={setFailure}
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

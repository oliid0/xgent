import { Dialog, type DialogPurpose } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import type { ReactNode } from "react";

type SettingsModalShellProps = {
  children: ReactNode;
  onClose: () => void;
  purpose?: DialogPurpose;
  ariaLabel?: string;
  panelClassName?: string;
};

/** Shared Astryx dialog boundary for every nested settings workflow. */
export function SettingsModalShell({
  children,
  onClose,
  purpose = "info",
  ariaLabel,
  panelClassName,
}: SettingsModalShellProps) {
  const isCompact = useMediaQuery("(max-width: 640px)");

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-label={ariaLabel ?? "Settings"}
      purpose={purpose}
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-content-width-md)"}
      maxHeight={isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-dialog-height-lg)"}
      padding={0}
      className={panelClassName}
    >
      {children}
    </Dialog>
  );
}

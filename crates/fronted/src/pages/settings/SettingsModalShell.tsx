import type { DialogPurpose } from "@astryxdesign/core/Dialog";
import { VStack } from "@astryxdesign/core/Layout";
import type { ReactNode } from "react";

type SettingsModalShellProps = {
  children: ReactNode;
  onClose: () => void;
  purpose?: DialogPurpose;
  ariaLabel?: string;
  panelClassName?: string;
};

/** Shared Astryx content boundary for nested settings workflows. */
export function SettingsModalShell({
  children,
  purpose = "info",
  ariaLabel,
  panelClassName,
}: SettingsModalShellProps) {
  return (
    <VStack
      width="100%"
      height="100%"
      minHeight={0}
      gap={0}
      role="region"
      aria-label={ariaLabel ?? "Settings"}
      data-purpose={purpose}
      className={panelClassName}
    >
      {children}
    </VStack>
  );
}

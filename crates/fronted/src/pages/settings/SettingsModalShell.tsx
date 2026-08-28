import type { DialogPurpose } from "@astryxdesign/core/Dialog";
import { VStack } from "@astryxdesign/core/Layout";
import { createContext, type ReactNode, useContext, useEffect } from "react";

const SettingsDetailLayerContext = createContext<((delta: 1 | -1) => void) | null>(null);

export function SettingsDetailLayerProvider({
  children,
  onLayerChange,
}: {
  children: ReactNode;
  onLayerChange: (delta: 1 | -1) => void;
}) {
  return (
    <SettingsDetailLayerContext.Provider value={onLayerChange}>
      {children}
    </SettingsDetailLayerContext.Provider>
  );
}

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
  const onLayerChange = useContext(SettingsDetailLayerContext);

  useEffect(() => {
    onLayerChange?.(1);
    return () => onLayerChange?.(-1);
  }, [onLayerChange]);

  return (
    <VStack
      width="100%"
      height="100%"
      minHeight={0}
      gap={0}
      role="region"
      aria-label={ariaLabel ?? "Settings"}
      data-purpose={purpose}
      data-settings-detail-layer
      className={panelClassName}
    >
      {children}
    </VStack>
  );
}

import type { DialogPurpose } from "@astryxdesign/core/Dialog";
import { VStack } from "@astryxdesign/core/Layout";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from "react";
import { useMobileBackNavigation } from "../../lib/useMobileBackNavigation";

const SettingsDetailLayerContext = createContext<((delta: 1 | -1) => void) | null>(null);

export function SettingsDetailLayerProvider({
  children,
  onLayerChange,
}: {
  children: ReactNode;
  onLayerChange: (delta: 1 | -1) => void;
}) {
  const parentLayerChange = useContext(SettingsDetailLayerContext);
  const reportLayerChange = useCallback(
    (delta: 1 | -1) => {
      onLayerChange(delta);
      parentLayerChange?.(delta);
    },
    [onLayerChange, parentLayerChange],
  );
  return (
    <SettingsDetailLayerContext.Provider value={reportLayerChange}>
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
  onClose,
  purpose = "info",
  ariaLabel,
  panelClassName,
}: SettingsModalShellProps) {
  const onLayerChange = useContext(SettingsDetailLayerContext);
  const panelRef = useRef<HTMLElement>(null);
  useMobileBackNavigation(
    true,
    () => {
      if (purpose !== "required") onClose();
    },
    30,
    () => panelRef.current,
  );

  useEffect(() => {
    onLayerChange?.(1);
    return () => onLayerChange?.(-1);
  }, [onLayerChange]);

  return (
    <VStack
      ref={panelRef}
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

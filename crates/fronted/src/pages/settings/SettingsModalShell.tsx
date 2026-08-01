import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type SettingsModalShellProps = {
  children: ReactNode;
  onClose: () => void;
  state?: string;
  ariaLabel?: string;
  panelClassName?: string;
  showScrim?: boolean;
};

/**
 * Shared settings dialog chrome.
 *
 * Desktop uses one plain scrim and one opaque surface. Compact viewports use
 * a real full-screen destination, so nested settings never become a shrunken
 * desktop dialog or stack translucent panels over each other.
 */
export function SettingsModalShell({
  children,
  onClose,
  state,
  ariaLabel,
  panelClassName = "max-h-[92vh] max-w-3xl",
  showScrim = true,
}: SettingsModalShellProps) {
  return createPortal(
    <div
      className="settings-modal-overlay fixed inset-0 z-[70] flex items-center justify-center p-4 max-sm:p-0"
      data-state={state}
    >
      {showScrim ? (
        <button
          type="button"
          aria-label={ariaLabel ?? "Close dialog"}
          className="absolute inset-0 bg-black/40 max-sm:hidden"
          onClick={onClose}
        />
      ) : null}
      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`settings-modal-panel relative z-10 flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl max-sm:h-full max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:shadow-none ${panelClassName}`}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}

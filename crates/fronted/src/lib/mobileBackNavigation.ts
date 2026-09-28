export const MOBILE_BACK_EVENT = "xgent:mobile-back";

type BackDestination = {
  run: () => void;
  priority: number;
  owner?: () => HTMLElement | null;
};

/** Back follows the visible destination; hidden retained pages cannot claim it. */
export function createMobileBackNavigation() {
  const destinations = new Map<symbol, BackDestination>();
  return {
    register(destination: BackDestination) {
      const key = Symbol();
      destinations.set(key, destination);
      return () => {
        destinations.delete(key);
      };
    },
    dispatch(document: Document): boolean {
      const modals = Array.from(
        document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
      ).filter((dialog) => dialog.matches(":modal"));
      const focusedModal = document.activeElement?.closest("dialog");
      const modal = focusedModal && modals.includes(focusedModal) ? focusedModal : modals.at(-1);
      const popovers = Array.from(document.querySelectorAll<HTMLElement>(":popover-open")).filter(
        (popover) => !modal || modal.contains(popover),
      );
      const focusedPopover = document.activeElement?.closest<HTMLElement>(":popover-open");
      const popover =
        focusedPopover && popovers.includes(focusedPopover) ? focusedPopover : popovers.at(-1);
      if (popover) {
        // The native toggle event synchronizes Astryx's controlled menu state.
        popover.hidePopover();
        return true;
      }
      const visible = [...destinations.values()].filter((destination) => {
        if (!destination.owner) return !modal;
        const owner = destination.owner();
        if (!owner?.isConnected || owner.closest("[inert],[aria-hidden=true]")) return false;
        const dialog = owner.closest("dialog");
        if (dialog && !dialog.open) return false;
        return !modal || modal.contains(owner);
      });
      const destination = visible
        .sort((left, right) => {
          const leftOwner = left.owner?.();
          const rightOwner = right.owner?.();
          if (leftOwner && rightOwner && leftOwner !== rightOwner) {
            if (leftOwner.contains(rightOwner)) return -1;
            if (rightOwner.contains(leftOwner)) return 1;
          }
          return left.priority - right.priority;
        })
        .at(-1);
      if (destination) {
        destination.run();
        return true;
      }
      if (!modal) return false;
      // Astryx owns cancel, including required-dialog refusal and controlled state.
      if (modal.dispatchEvent(new Event("cancel", { cancelable: true }))) modal.close();
      return true;
    },
  };
}

export const mobileBackNavigation = createMobileBackNavigation();

export function installMobileBackNavigation(target: Window, document: Document) {
  const back = (event: Event) => {
    if (mobileBackNavigation.dispatch(document)) event.preventDefault();
  };
  target.addEventListener(MOBILE_BACK_EVENT, back);
  return () => target.removeEventListener(MOBILE_BACK_EVENT, back);
}

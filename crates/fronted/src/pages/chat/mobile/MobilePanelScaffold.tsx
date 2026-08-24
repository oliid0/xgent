import type { ReactNode } from "react";
import { ArrowLeft } from "../../../components/icons";
import { cn } from "../../../lib/shared/utils";

type MobileFullscreenPanelProps = {
  open: boolean;
  children: ReactNode;
  label: string;
  className?: string;
  keepMounted?: boolean;
};

/**
 * A viewport-owned mobile destination. It deliberately uses `fixed` positioning so parent chat
 * transforms, overflow and desktop split panes can never reduce a tool to a responsive drawer.
 */
export function MobileFullscreenPanel(props: MobileFullscreenPanelProps) {
  if (!props.open && !props.keepMounted) return null;
  return (
    <section
      data-edge-swipe-ignore
      aria-label={props.label}
      aria-hidden={!props.open}
      className={cn(
        "mobile-fullscreen-panel fixed inset-0 z-[74] flex h-[100dvh] w-screen min-h-0 flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] pt-[env(safe-area-inset-top,0px)] text-foreground",
        !props.open && "pointer-events-none translate-x-[8%] opacity-0",
        props.className,
      )}
    >
      {props.children}
    </section>
  );
}

export function MobilePanelHeader(props: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  backLabel: string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mobile-panel-header flex min-h-14 shrink-0 items-center gap-3 border-b border-border/55 bg-background/90 px-3 backdrop-blur-xl",
        props.className,
      )}
    >
      <button
        type="button"
        onClick={props.onBack}
        className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-xl text-muted-foreground transition-colors active:bg-muted active:text-foreground"
        aria-label={props.backLabel}
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      {props.leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{props.subtitle}</p>
        ) : null}
      </div>
      {props.actions}
    </header>
  );
}

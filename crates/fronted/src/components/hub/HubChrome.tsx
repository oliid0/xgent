import type { ReactNode } from "react";
import { useLocale } from "../../i18n";
import { cn } from "../../lib/shared/utils";
import { PanelLeft, X } from "../icons";
import { isMacOsTauri, MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import { Button } from "../ui/button";

export function HubBackdrop(props: { tone?: "amber" | "violet" | "neutral" }) {
  return (
    <div
      aria-hidden="true"
      data-hub-tone={props.tone ?? "neutral"}
      className="hub-backdrop pointer-events-none absolute inset-0"
    />
  );
}

export function HubHeader(props: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tone?: "amber" | "violet" | "neutral";
  actions?: ReactNode;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  const {
    icon,
    title,
    subtitle,
    tone = "neutral",
    actions,
    sidebarOpen,
    onOpenSidebar,
    onClose,
    closeLabel,
  } = props;
  const { t } = useLocale();
  const isMacTitleBarOverlay = isMacOsTauri();
  const showSidebarButton = !onClose && !sidebarOpen && !isMacTitleBarOverlay;
  return (
    <>
      <MacOsTitleBarSpacer />
      <div
        data-close-navigation={onClose ? "true" : undefined}
        className="hub-header relative z-10 px-4 pb-3 pt-4 sm:px-6 lg:px-8 xl:px-10"
      >
        {showSidebarButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenSidebar}
            title={t("tooltip.openSidebar")}
            className="hub-header-sidebar-button absolute left-3 top-3 h-10 w-10 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeft className="h-4.5 w-4.5" />
          </Button>
        ) : null}
        <div
          className={cn(
            "mx-auto flex w-full max-w-[1320px] items-center gap-4",
            showSidebarButton && "pl-11 lg:pl-0",
          )}
        >
          {onClose ? <span className="h-11 w-11 shrink-0" aria-hidden="true" /> : null}
          {!onClose ? (
            <div
              data-hub-tone={tone}
              className="hub-header-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-foreground/80"
            >
              {icon}
            </div>
          ) : null}
          <div className={cn("min-w-0 flex-1", onClose && "text-center")}>
            <h1 className="text-[21px] font-semibold leading-tight tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p
                className={cn(
                  "mt-0.5 truncate text-[12px] text-muted-foreground",
                  onClose && "hidden",
                )}
                title={subtitle}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="hub-header-actions flex items-center gap-2">{actions}</div>
          ) : null}
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              title={closeLabel ?? t("settings.close")}
              aria-label={closeLabel ?? t("settings.close")}
              className="hub-header-close-button h-11 w-11 shrink-0 rounded-full border border-border/60 bg-background/80 text-foreground shadow-sm transition-[background-color,color,box-shadow] duration-150 active:bg-muted"
            >
              <X className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Solid information surface shared by Skills and MCP hubs. */
export function HubPanel(props: {
  children: ReactNode;
  tone?: "default" | "muted" | "error" | "amber" | "violet" | "neutral";
  active?: boolean;
  className?: string;
}) {
  const { children, tone = "default", active = false, className } = props;
  const toneClass = (() => {
    switch (tone) {
      case "muted":
        return "border-border bg-muted";
      case "error":
        return "border-destructive/30 bg-destructive/5";
      case "amber":
      case "violet":
      case "neutral":
        return active ? "border-foreground/20 bg-card shadow-sm" : "border-border bg-card";
      default:
        return "border-border bg-card";
    }
  })();
  return (
    <div className={cn("hub-panel rounded-xl border px-4 py-3.5", toneClass, className)}>
      {children}
    </div>
  );
}

/** Temporary source-compatible alias while callers migrate to the semantic name. */
export const GlassPanel = HubPanel;

export function HubSegmentedControl(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "hub-segmented-control inline-flex min-w-0 items-center rounded-xl bg-muted p-1",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function HubSegmentedButton(props: {
  active: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
      className={cn(
        "hub-segmented-button inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition-[color,background-color,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        props.active
          ? "bg-background text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

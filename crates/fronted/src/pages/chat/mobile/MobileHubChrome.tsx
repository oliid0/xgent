import type { ReactNode } from "react";
import { Search } from "../../../components/icons";

type MobileHubHeaderProps = {
  title: string;
  onOpenSidebar: () => void;
  trailing?: ReactNode;
};

/**
 * Shared navigation chrome for touch-first top-level pages.
 *
 * Keeping the header and search treatment here prevents Skills, MCP and later
 * mobile workspace pages from drifting into separate, desktop-derived layouts.
 */
export function MobileHubHeader(props: MobileHubHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border/35 bg-background/92 px-4 pb-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] backdrop-blur-2xl backdrop-saturate-150">
      <div className="flex min-h-12 items-center gap-3">
        <button
          type="button"
          onClick={props.onOpenSidebar}
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-[5px] rounded-full border border-border/55 bg-background text-foreground shadow-sm active:bg-muted"
          aria-label={props.title}
        >
          <span className="h-[3px] w-6 rounded-full bg-current" />
          <span className="h-[3px] w-4 rounded-full bg-current" />
        </button>
        <h1 className="min-w-0 flex-1 text-center text-[24px] font-semibold tracking-tight">
          {props.title}
        </h1>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center">{props.trailing}</div>
      </div>
    </header>
  );
}

export function MobileHubSearch(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="mx-4 mt-5 flex min-h-12 items-center gap-3 rounded-[1.6rem] border border-border/55 bg-background px-4 shadow-sm">
      <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.placeholder}
        className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/70"
        autoCapitalize="none"
        autoCorrect="off"
      />
    </label>
  );
}

export function MobileToggle(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-45 ${
        props.checked ? "bg-blue-500" : "bg-muted-foreground/25"
      }`}
    >
      <span
        className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
          props.checked ? "translate-x-[1.4rem]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

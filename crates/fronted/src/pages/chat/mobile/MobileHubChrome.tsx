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
    <header className="shrink-0 border-b border-border bg-background px-4 pb-4 pt-3">
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
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-150 disabled:opacity-45 ${
        props.checked
          ? "border-blue-500 bg-blue-500"
          : "border-border bg-muted-foreground/[0.28]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.32)] transition-transform duration-150 ${
          props.checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

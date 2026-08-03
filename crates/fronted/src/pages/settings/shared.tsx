import type { ReactNode } from "react";

export {
  ConfirmActionPopover,
  ConfirmDeletePopover,
} from "../../components/ui/confirm-action-popover";

export function SettingsRowGroup(props: {
  title: string;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <section className="settings-row-section mb-7">
      <h3
        className={`mb-2 px-1 text-xs font-semibold uppercase tracking-wide ${
          props.tone === "danger" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {props.title}
      </h3>
      <div
        className={`settings-row-group divide-y overflow-hidden rounded-xl border text-sm ${
          props.tone === "danger" ? "border-destructive/30" : "border-border/70"
        }`}
      >
        {props.children}
      </div>
    </section>
  );
}

export function SettingsRow(props: {
  label: string;
  description?: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`settings-row flex min-h-14 gap-4 px-4 py-3 ${
        props.align === "start" ? "items-start" : "items-center"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{props.label}</div>
        {props.description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      <div className="settings-row-control flex shrink-0 items-center justify-end">
        {props.children}
      </div>
    </div>
  );
}

export function PromptTag({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] leading-none ${
        muted
          ? "border-border/60 bg-muted/40 text-muted-foreground"
          : "border-border/70 bg-muted/60 text-foreground/80"
      }`}
    >
      {label}
    </span>
  );
}

export function AgentActivationSwitch(props: {
  checked: boolean;
  title: string;
  disabled?: boolean;
  className?: string;
  onToggle: () => void;
}) {
  const { checked, title, disabled = false, className, onToggle } = props;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={disabled ? undefined : onToggle}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 ${
        checked
          ? "border-sky-500 bg-sky-500 shadow-inner"
          : disabled
            ? "border-border/55 bg-muted/65"
            : "border-border bg-muted-foreground/[0.28] hover:bg-muted-foreground/[0.36]"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.32)] transition-transform duration-150 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

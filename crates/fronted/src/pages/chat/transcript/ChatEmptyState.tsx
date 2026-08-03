import { useEffect, useState } from "react";

import iconSimpleUrl from "../../../../src-tauri/icons/icon-simple.png";
import { FolderTree, Lightbulb, Settings, Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SectionId } from "../../settings/types";

type GreetingPeriod = "morning" | "noon" | "afternoon" | "evening" | "night";

const GREETING_KEYS: Record<GreetingPeriod, string> = {
  morning: "chat.greetingMorning",
  noon: "chat.greetingNoon",
  afternoon: "chat.greetingAfternoon",
  evening: "chat.greetingEvening",
  night: "chat.greetingNight",
};

function resolveGreetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

function useGreetingPeriod() {
  const [period, setPeriod] = useState<GreetingPeriod>(() =>
    resolveGreetingPeriod(new Date().getHours()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPeriod(resolveGreetingPeriod(new Date().getHours()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return period;
}

const SUGGESTION_CARDS = [
  {
    key: "explore",
    icon: FolderTree,
    chipClassName: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    titleKey: "chat.suggestExploreTitle",
    promptKey: "chat.suggestExplorePrompt",
  },
  {
    key: "fix",
    icon: Wrench,
    chipClassName: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    titleKey: "chat.suggestFixTitle",
    promptKey: "chat.suggestFixPrompt",
  },
  {
    key: "ideate",
    icon: Lightbulb,
    chipClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    titleKey: "chat.suggestIdeateTitle",
    promptKey: "chat.suggestIdeatePrompt",
  },
] as const;

export type ChatEmptyStateProps = {
  variant: "no-models" | "start-chat";
  onOpenSettings?: (section?: SectionId) => void;
  onSuggestionSelect?: (text: string) => void;
  /** Locks the suggestion cards while a picked prompt is still typing in. */
  suggestionsDisabled?: boolean;
};

export function ChatEmptyState({
  variant,
  onOpenSettings,
  onSuggestionSelect,
  suggestionsDisabled = false,
}: ChatEmptyStateProps) {
  const { t } = useLocale();
  const period = useGreetingPeriod();

  return (
    <div className="chat-empty-state relative flex w-full flex-col items-center">
      <div className="chat-hero-logo-enter relative mb-5 flex h-16 w-16 items-center justify-center">
        <div className="chat-hero-logo-float relative flex h-full w-full items-center justify-center">
          <div
            aria-hidden="true"
            className="chat-hero-halo-breathe absolute inset-1 rounded-full bg-sky-500/10 blur-xl dark:bg-sky-400/10"
          />
          <img
            src={iconSimpleUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="relative h-14 w-14 select-none object-contain"
          />
        </div>
      </div>

      {variant === "no-models" ? (
        <>
          <div className="chat-hero-title-enter mb-1.5 text-center text-[calc(22px*var(--zone-font-scale,1))] font-semibold leading-7 tracking-tight text-foreground">
            {t("chat.welcome")}
          </div>
          <div className="chat-hero-line-enter mb-0.5 text-center text-sm leading-5 text-muted-foreground">
            {t("chat.noModelSelected")}
          </div>
          <div className="chat-hero-line-enter text-center text-sm leading-5 text-muted-foreground">
            {t("chat.configureModel")}
          </div>
          {onOpenSettings ? (
            <button
              type="button"
              onClick={() => onOpenSettings("providers")}
              className="chat-hero-cta-enter mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[background-color,transform] duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              <Settings className="h-4 w-4" />
              {t("chat.goToSettings")}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="chat-hero-title-enter px-5 text-center text-[calc(22px*var(--zone-font-scale,1))] font-semibold leading-8 tracking-tight text-foreground">
            {t(GREETING_KEYS[period])}，{t("chat.greetingSubtitle")}
          </div>
          {onSuggestionSelect ? (
            <div className="chat-suggestion-grid mt-8 grid w-full max-w-[720px] grid-cols-1 gap-2.5 px-5 sm:grid-cols-3 sm:px-4">
              {SUGGESTION_CARDS.map((card) => (
                <button
                  key={card.key}
                  type="button"
                  disabled={suggestionsDisabled}
                  onClick={() => onSuggestionSelect(t(card.promptKey))}
                  className="chat-suggestion-card chat-hero-card-enter flex min-h-[76px] items-center gap-3 rounded-2xl border border-border/40 bg-card/55 px-3.5 py-3 text-left text-foreground/85 shadow-[inset_0_1px_0_hsl(var(--background)/0.72)] transition-[color,background-color,border-color,transform] duration-150 hover:border-border/65 hover:bg-card/80 hover:text-foreground focus-visible:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${card.chipClassName}`}
                  >
                    <card.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[calc(14px*var(--zone-font-scale,1))] font-semibold leading-5 text-foreground/90">
                      {t(card.titleKey)}
                    </span>
                    <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-4 text-muted-foreground">
                      {t(card.promptKey)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

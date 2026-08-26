import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
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
    variant: "blue",
    titleKey: "chat.suggestExploreTitle",
    promptKey: "chat.suggestExplorePrompt",
  },
  {
    key: "fix",
    icon: Wrench,
    variant: "orange",
    titleKey: "chat.suggestFixTitle",
    promptKey: "chat.suggestFixPrompt",
  },
  {
    key: "ideate",
    icon: Lightbulb,
    variant: "green",
    titleKey: "chat.suggestIdeateTitle",
    promptKey: "chat.suggestIdeatePrompt",
  },
] as const;

export type ChatEmptyStateProps = {
  variant: "no-models" | "start-chat";
  onOpenSettings?: (section?: SectionId) => void;
  onSuggestionSelect?: (text: string) => void;
  suggestionsDisabled?: boolean;
};

function ProductMark() {
  return (
    <img
      src={iconSimpleUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="h-14 w-14 select-none object-contain"
    />
  );
}

export function ChatEmptyState({
  variant,
  onOpenSettings,
  onSuggestionSelect,
  suggestionsDisabled = false,
}: ChatEmptyStateProps) {
  const { t } = useLocale();
  const period = useGreetingPeriod();

  if (variant === "no-models") {
    return (
      <EmptyState
        icon={<ProductMark />}
        title={t("chat.welcome")}
        description={`${t("chat.noModelSelected")} ${t("chat.configureModel")}`}
        headingLevel={2}
        actions={
          onOpenSettings ? (
            <Button
              label={t("chat.goToSettings")}
              icon={<Settings />}
              variant="primary"
              onClick={() => onOpenSettings("providers")}
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <VStack className="chat-empty-state" width="100%" gap={6} hAlign="center">
      <EmptyState
        icon={<ProductMark />}
        title={`${t(GREETING_KEYS[period])}，${t("chat.greetingSubtitle")}`}
        headingLevel={2}
      />
      {onSuggestionSelect ? (
        <Grid
          columns={{ minWidth: 160, max: 3, repeat: "fit" }}
          gap={3}
          width="100%"
          maxWidth="var(--xagent-content-width-lg)"
        >
          {SUGGESTION_CARDS.map((card) => (
            <ClickableCard
              key={card.key}
              label={t(card.titleKey)}
              variant={card.variant}
              padding={3}
              isDisabled={suggestionsDisabled}
              onClick={() => onSuggestionSelect(t(card.promptKey))}
            >
              <HStack gap={3} vAlign="center">
                <card.icon className="h-5 w-5 shrink-0" />
                <VStack gap={0.5} className="min-w-0">
                  <Text type="label" display="block" className="truncate">
                    {t(card.titleKey)}
                  </Text>
                  <Text type="supporting" color="secondary" display="block" className="truncate">
                    {t(card.promptKey)}
                  </Text>
                </VStack>
              </HStack>
            </ClickableCard>
          ))}
        </Grid>
      ) : null}
    </VStack>
  );
}

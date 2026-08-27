import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Heading } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

import iconSimpleUrl from "../../../../src-tauri/icons/icon-simple.png";
import { FolderTree, Lightbulb, Settings, Wrench } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SectionId } from "../../settings/types";

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
  composer?: ReactNode;
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
  composer,
}: ChatEmptyStateProps) {
  const { t } = useLocale();

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
    <VStack width="100%" gap={5} hAlign="center">
      <Heading level={1}>{t("chat.greetingSubtitle")}</Heading>
      {composer}
      {onSuggestionSelect ? (
        <VStack width="100%" maxWidth="var(--xagent-chat-landing-suggestions-width)">
          <List density="spacious">
            {SUGGESTION_CARDS.map((card) => (
              <ListItem
                key={card.key}
                label={t(card.titleKey)}
                startContent={<card.icon />}
                isDisabled={suggestionsDisabled}
                onClick={() => onSuggestionSelect(t(card.promptKey))}
              />
            ))}
          </List>
        </VStack>
      ) : null}
    </VStack>
  );
}

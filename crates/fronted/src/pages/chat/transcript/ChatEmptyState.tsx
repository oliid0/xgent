import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

import iconSimpleUrl from "../../../../src-tauri/icons/icon-simple.png";
import { FolderTree, Lightbulb, Wrench } from "../../../components/icons";
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
    key: "build",
    icon: Wrench,
    variant: "purple",
    titleKey: "chat.suggestBuildTitle",
    promptKey: "chat.suggestBuildPrompt",
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
              variant="primary"
              onClick={() => onOpenSettings("providers")}
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <VStack width="100%" gap={6} hAlign="center" className="chat-empty-state">
      <ProductMark />
      <Heading level={1} className="chat-empty-state-heading">
        {t("chat.greetingSubtitle")}
      </Heading>
      {onSuggestionSelect ? (
        <div className="chat-suggestion-grid">
          {SUGGESTION_CARDS.map((card) => (
            <button
              type="button"
              key={card.key}
              disabled={suggestionsDisabled}
              onClick={() => onSuggestionSelect(t(card.promptKey))}
            >
              <card.icon />
              <span>{t(card.titleKey)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {composer}
    </VStack>
  );
}

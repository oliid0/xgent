import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { ComplexSelector } from "@astryxdesign/core/ComplexSelector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { memo, useMemo, useState } from "react";

import {
  Check,
  ClaudeIcon,
  GeminiIcon,
  OpenaiChatgptIcon,
  Search,
  Sparkle,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { groupModelOptionsByProvider } from "../../../lib/chat/page/chatPageHelpers";
import { type ModelOption, parseModelValue } from "../../../lib/providers/llm";
import type { ProviderId, SelectedModel } from "../../../lib/settings";

function ProviderBrandIcon({ type }: { type: ProviderId }) {
  if (type === "claude_code") return <ClaudeIcon size={16} />;
  if (type === "gemini") return <GeminiIcon size={16} />;
  return <OpenaiChatgptIcon size={16} />;
}

function ModelSelectorContent(props: {
  modelOptions: ModelOption[];
  selectedValue: string;
  onChange: (value: string) => void;
  close: () => void;
}) {
  const { t } = useLocale();
  const [modelSearch, setModelSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const normalizedSearch = modelSearch.trim().toLowerCase();
  const groups = useMemo(
    () => groupModelOptionsByProvider(props.modelOptions),
    [props.modelOptions],
  );
  const selectedGroupId = props.modelOptions.find(
    (option) => option.value === props.selectedValue,
  )?.providerId;
  const filteredGroups = useMemo(
    () =>
      normalizedSearch
        ? groups
            .map((group) => ({
              ...group,
              opts: group.opts.filter(
                (option) =>
                  option.model.toLowerCase().includes(normalizedSearch) ||
                  option.providerName.toLowerCase().includes(normalizedSearch),
              ),
            }))
            .filter((group) => group.opts.length > 0)
        : groups,
    [groups, normalizedSearch],
  );

  return (
    <VStack gap={3} width="var(--xagent-model-selector-width)">
      <TextInput
        label={t("chat.searchModel")}
        isLabelHidden
        hasAutoFocus
        value={modelSearch}
        onChange={setModelSearch}
        placeholder={t("chat.searchModel")}
        startIcon={<Search size={16} />}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {filteredGroups.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Search size={20} />}
          title={t("chat.noModelFound")}
          description={t("chat.searchModel")}
        />
      ) : (
        <VStack
          gap={1}
          isScrollable
          style={{ maxHeight: "var(--xagent-model-selector-list-height)" }}
        >
          <CollapsibleGroup type="multiple" hasDividers>
            {filteredGroups.map((group) => {
              const isExpanded =
                normalizedSearch.length > 0 ||
                (expandedGroups[group.id] ?? group.id === selectedGroupId);
              return (
                <Collapsible
                  key={group.id}
                  value={group.id}
                  isOpen={isExpanded}
                  onOpenChange={(next) =>
                    setExpandedGroups((current) => ({ ...current, [group.id]: next }))
                  }
                  trigger={
                    <HStack gap={2} width="100%" vAlign="center">
                      <ProviderBrandIcon type={group.providerType} />
                      <Text type="body" weight="medium">
                        {group.name}
                      </Text>
                      <Badge variant="neutral" label={group.opts.length} />
                    </HStack>
                  }
                >
                  <List density="compact">
                    {group.opts.map((option) => {
                      const isSelected = option.value === props.selectedValue;
                      return (
                        <ListItem
                          key={option.value}
                          label={option.model}
                          startContent={<ProviderBrandIcon type={option.providerType} />}
                          endContent={isSelected ? <Check size={16} /> : undefined}
                          isSelected={isSelected}
                          onClick={() => {
                            props.onChange(option.value);
                            props.close();
                          }}
                        />
                      );
                    })}
                  </List>
                </Collapsible>
              );
            })}
          </CollapsibleGroup>
        </VStack>
      )}
    </VStack>
  );
}

export const ChatModelSelector = memo(function ChatModelSelector(props: {
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  isDisabled?: boolean;
  onSelectModel: (selection: SelectedModel) => void;
}) {
  const { t } = useLocale();
  const selectedValue = props.selectedValue ?? "";
  const selectedOption = props.modelOptions.find((option) => option.value === selectedValue);

  return (
    <ComplexSelector<string>
      label={t("chat.selectModel")}
      value={selectedValue}
      onChange={(value) => {
        const parsed = parseModelValue(value);
        if (parsed) props.onSelectModel(parsed);
      }}
      triggerLabel={selectedOption?.model ?? props.currentModelLabel}
      startIcon={
        selectedOption ? <ProviderBrandIcon type={selectedOption.providerType} /> : <Sparkle />
      }
      isDisabled={props.isDisabled || !props.hasModels}
      variant="ghost"
      size="sm"
      placement="above"
      alignment="start"
    >
      {(value, onChange, close) => (
        <ModelSelectorContent
          modelOptions={props.modelOptions}
          selectedValue={value}
          onChange={onChange}
          close={close}
        />
      )}
    </ComplexSelector>
  );
});

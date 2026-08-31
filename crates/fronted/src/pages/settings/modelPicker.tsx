import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { ComplexSelector } from "@astryxdesign/core/ComplexSelector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useMemo, useState } from "react";

import {
  Check,
  ClaudeIcon,
  GeminiIcon,
  OpenaiChatgptIcon,
  Search,
  Sparkles,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import type { ProviderId } from "../../lib/settings";

export type ModelPickerOption = {
  value: string;
  label: string;
  providerName: string;
  providerId?: string;
  providerType?: ProviderId;
};

function ProviderBrandIcon({ type }: { type?: ProviderId }) {
  if (type === "claude_code") return <ClaudeIcon size={16} />;
  if (type === "gemini") return <GeminiIcon size={16} />;
  return <OpenaiChatgptIcon size={16} />;
}

type ModelGroup = {
  id: string;
  name: string;
  providerType?: ProviderId;
  opts: ModelPickerOption[];
};

function groupOptionsByProvider(options: ModelPickerOption[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  const byId = new Map<string, ModelGroup>();
  for (const option of options) {
    const id = option.providerId ?? option.providerName;
    let group = byId.get(id);
    if (!group) {
      group = { id, name: option.providerName, providerType: option.providerType, opts: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.opts.push(option);
  }
  return groups;
}

function ModelPickerContent(props: {
  options: ModelPickerOption[];
  value: string;
  noneLabel?: string;
  onChange: (value: string) => void;
  close: () => void;
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const normalizedSearch = search.trim().toLowerCase();
  const groups = useMemo(() => groupOptionsByProvider(props.options), [props.options]);
  const selectedOption = props.options.find((option) => option.value === props.value);
  const selectedGroupId = selectedOption
    ? (selectedOption.providerId ?? selectedOption.providerName)
    : undefined;
  const filteredGroups = useMemo(
    () =>
      normalizedSearch
        ? groups
            .map((group) => ({
              ...group,
              opts: group.opts.filter(
                (option) =>
                  option.label.toLowerCase().includes(normalizedSearch) ||
                  option.providerName.toLowerCase().includes(normalizedSearch),
              ),
            }))
            .filter((group) => group.opts.length > 0)
        : groups,
    [groups, normalizedSearch],
  );
  const select = (nextValue: string) => {
    props.onChange(nextValue);
    props.close();
  };

  return (
    <VStack gap={3} width="var(--xgent-model-selector-width)">
      <TextInput
        label={t("chat.searchModel")}
        isLabelHidden
        hasAutoFocus
        hasClear
        value={search}
        onChange={setSearch}
        placeholder={t("chat.searchModel")}
        startIcon={<Search size={16} />}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <VStack gap={1} isScrollable style={{ maxHeight: "var(--xgent-model-selector-list-height)" }}>
        {props.noneLabel && !normalizedSearch ? (
          <List density="compact">
            <ListItem
              label={props.noneLabel}
              startContent={<Sparkles size={16} />}
              endContent={props.value === "" ? <Check size={16} /> : undefined}
              isSelected={props.value === ""}
              onClick={() => select("")}
            />
          </List>
        ) : null}
        {filteredGroups.length === 0 ? (
          <EmptyState
            isCompact
            icon={<Search size={20} />}
            title={t("chat.noModelFound")}
            description={t("chat.searchModel")}
          />
        ) : (
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
                      const isSelected = option.value === props.value;
                      return (
                        <ListItem
                          key={option.value}
                          label={option.label}
                          startContent={<ProviderBrandIcon type={option.providerType} />}
                          endContent={isSelected ? <Check size={16} /> : undefined}
                          isSelected={isSelected}
                          onClick={() => select(option.value)}
                        />
                      );
                    })}
                  </List>
                </Collapsible>
              );
            })}
          </CollapsibleGroup>
        )}
      </VStack>
    </VStack>
  );
}

export function ModelPicker({
  options,
  value,
  onChange,
  disabled,
  placeholder,
  noneLabel,
  ariaLabel,
}: {
  options: ModelPickerOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  noneLabel?: string;
  ariaLabel?: string;
}) {
  const selectedOption = options.find((option) => option.value === value);
  return (
    <ComplexSelector<string>
      label={ariaLabel ?? placeholder}
      isLabelHidden
      value={value}
      onChange={onChange}
      triggerLabel={selectedOption?.label}
      placeholder={placeholder}
      startIcon={
        selectedOption ? (
          <ProviderBrandIcon type={selectedOption.providerType} />
        ) : (
          <Sparkles size={16} />
        )
      }
      isDisabled={disabled}
      variant="input"
      size="lg"
      width="100%"
      placement="below"
      alignment="start"
    >
      {(selectedValue, commit, close) => (
        <ModelPickerContent
          options={options}
          value={selectedValue}
          noneLabel={noneLabel}
          onChange={commit}
          close={close}
        />
      )}
    </ComplexSelector>
  );
}

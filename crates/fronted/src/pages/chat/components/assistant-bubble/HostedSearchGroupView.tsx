import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useMemo, useState } from "react";

import { Globe } from "../../../../components/icons";
import { useLocale } from "../../../../i18n";
import type { HostedSearchBlock } from "../../../../lib/chat/messages/hostedSearch";
import { AssistantStatus } from "./StatusText";

function getHostedSearchStatusLabel(
  t: (key: string) => string,
  status: HostedSearchBlock["status"],
) {
  switch (status) {
    case "failed":
      return t("chat.search.failed");
    case "completed":
      return t("chat.search.completed");
    default:
      return t("chat.search.searching");
  }
}

function getSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getHostedSearchGroupStatus(items: HostedSearchBlock[]): HostedSearchBlock["status"] {
  if (items.some((item) => item.status === "searching")) return "searching";
  if (items.every((item) => item.status === "failed")) return "failed";
  return "completed";
}

function getUniqueHostedSearchQueries(items: HostedSearchBlock[]) {
  const out: string[] = [];
  for (const item of items) {
    for (const query of item.queries) {
      const text = query.trim();
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

function getUniqueHostedSearchSources(items: HostedSearchBlock[]) {
  const out = new Map<string, HostedSearchBlock["sources"][number]>();
  for (const item of items) {
    for (const source of item.sources) {
      if (!source.url || out.has(source.url)) continue;
      out.set(source.url, source);
    }
  }
  return [...out.values()];
}

function getLatestHostedSearchTitle(
  items: HostedSearchBlock[],
  t: (key: string) => string,
  status: HostedSearchBlock["status"],
) {
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    for (let queryIndex = item.queries.length - 1; queryIndex >= 0; queryIndex -= 1) {
      const query = item.queries[queryIndex]?.trim();
      if (query) return query;
    }
    const latestSource = item.sources[item.sources.length - 1];
    if (latestSource?.title) return latestSource.title;
    if (latestSource?.url) return getSourceHost(latestSource.url);
  }
  if (status !== "searching") return getHostedSearchStatusLabel(t, status);
  return t("chat.search.noQuery");
}

export function HostedSearchGroupView({ items }: { items: HostedSearchBlock[] }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const queries = useMemo(() => getUniqueHostedSearchQueries(items), [items]);
  const sources = useMemo(() => getUniqueHostedSearchSources(items), [items]);
  const visibleSources = sources.slice(0, 10);
  const status = getHostedSearchGroupStatus(items);
  const statusLabel = getHostedSearchStatusLabel(t, status);
  const latestTitle = getLatestHostedSearchTitle(items, t, status);
  const hasDetails = queries.length > 0 || visibleSources.length > 0;

  return (
    <Collapsible
      isOpen={open}
      isDisabled={!hasDetails}
      onOpenChange={setOpen}
      trigger={
        <HStack gap={2} vAlign="center">
          <Globe />
          <VStack gap={0.5}>
            <HStack gap={1.5} vAlign="center">
              <Text type="label">{t("chat.search.webSearch")}</Text>
              <Badge label={items.length} variant="neutral" />
            </HStack>
            <Text type="supporting" color="secondary" maxLines={1}>
              {latestTitle}
            </Text>
          </VStack>
          {status === "searching" ? (
            <AssistantStatus>{statusLabel}</AssistantStatus>
          ) : (
            <Token
              label={statusLabel}
              size="sm"
              color={status === "failed" ? "red" : "green"}
            />
          )}
        </HStack>
      }
    >
      <VStack gap={2}>
        {queries.length > 0 ? (
          <HStack gap={1} wrap="wrap">
            {queries.map((query) => (
              <Token key={query} label={query} size="sm" color="blue" />
            ))}
          </HStack>
        ) : null}
        {visibleSources.length > 0 ? (
          <List density="compact" hasDividers header={t("chat.search.sources")}>
            {visibleSources.map((source) => (
              <ListItem
                key={source.url}
                label={source.title || getSourceHost(source.url)}
                description={getSourceHost(source.url)}
                href={source.url}
                target="_blank"
                startContent={<Globe />}
              />
            ))}
          </List>
        ) : null}
      </VStack>
    </Collapsible>
  );
}

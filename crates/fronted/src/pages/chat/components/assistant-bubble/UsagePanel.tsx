import { VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import type { Usage } from "@earendil-works/pi-ai";

import { useLocale } from "../../../../i18n";

function hasDisplayableUsage(usage: Usage | undefined): usage is Usage {
  if (!usage) return false;

  return (
    usage.totalTokens > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    (usage.cost?.total ?? 0) > 0
  );
}

function formatUsageNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUsageCost(value: number, locale: string) {
  if (value <= 0) return "$0";

  const maximumFractionDigits = value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  return `$${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)}`;
}

export function UsagePanel(props: { usage?: Usage; contextWindow?: number }) {
  const { usage, contextWindow } = props;
  const { t, locale } = useLocale();

  if (!hasDisplayableUsage(usage)) return null;

  const stats: Array<{ key: string; label: string; value: string }> = [
    {
      key: "total",
      label: t("chat.usageTotal"),
      value: formatUsageNumber(usage.totalTokens, locale),
    },
    {
      key: "input",
      label: t("chat.usageInput"),
      value: formatUsageNumber(usage.input, locale),
    },
    {
      key: "output",
      label: t("chat.usageOutput"),
      value: formatUsageNumber(usage.output, locale),
    },
    ...(usage.cacheRead > 0
      ? [
          {
            key: "cache-read",
            label: t("chat.usageCacheRead"),
            value: formatUsageNumber(usage.cacheRead, locale),
          },
        ]
      : []),
    ...(usage.cacheWrite > 0
      ? [
          {
            key: "cache-write",
            label: t("chat.usageCacheWrite"),
            value: formatUsageNumber(usage.cacheWrite, locale),
          },
        ]
      : []),
    ...((usage.cost?.total ?? 0) > 0
      ? [
          {
            key: "cost",
            label: t("chat.usageCost"),
            value: formatUsageCost(usage.cost?.total ?? 0, locale),
          },
        ]
      : []),
  ];
  const contextUsed = Math.max(0, usage.input + usage.cacheRead + usage.cacheWrite);
  const contextRatio =
    typeof contextWindow === "number" && contextWindow > 0 ? contextUsed / contextWindow : 0;

  return (
    <VStack gap={1.5}>
      {typeof contextWindow === "number" && contextWindow > 0 ? (
        <ProgressBar
          label={t("chat.contextWindow")}
          value={Math.min(contextUsed, contextWindow)}
          max={contextWindow}
          hasValueLabel
          formatValueLabel={(value, max) =>
            `${formatUsageNumber(value, locale)} / ${formatUsageNumber(max, locale)}`
          }
          variant={contextRatio >= 0.95 ? "error" : contextRatio >= 0.8 ? "warning" : "accent"}
        />
      ) : null}
      <MetadataList orientation="horizontal" columns="multi" label={{ position: "top" }}>
        {stats.map((item) => (
          <MetadataListItem key={item.key} label={item.label}>
            {item.value}
          </MetadataListItem>
        ))}
      </MetadataList>
    </VStack>
  );
}

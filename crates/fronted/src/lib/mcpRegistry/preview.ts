import type { McpRegistryCard, McpRegistryConfigInput } from "./index";

export function configTargetLabel(input: McpRegistryConfigInput, t: (key: string) => string) {
  if (input.target === "env") return t("mcpHub.previewEnv");
  if (input.target === "header") return t("mcpHub.previewHeaders");
  if (input.target === "argument") return t("mcpHub.previewArgs");
  if (input.target === "url") return "URL";
  return t("mcpHub.storeConfigureTitle");
}

export function installLabelKey(card: McpRegistryCard) {
  if (!card.installDraft && card.source === "smithery") return "mcpHub.storeInstall";
  if (card.installDraft?.status === "needs_config") return "mcpHub.storeConfigure";
  return card.installDraft ? "mcpHub.storeInstall" : "mcpHub.storeManualOnly";
}

export function configureDraftForCard(card: McpRegistryCard) {
  return card.installDraft ?? card.manualDraft;
}

export function primaryRegistryLink(card: McpRegistryCard) {
  return card.detailUrl ?? card.homepageUrl ?? card.repositoryUrl;
}

export function registryExternalLinks(card: McpRegistryCard) {
  const candidates: Array<{ key: string; labelKey: string; url?: string }> = [
    { key: "detail", labelKey: "mcpHub.storePreviewDetailPage", url: card.detailUrl },
    { key: "homepage", labelKey: "mcpHub.storePreviewHomepage", url: card.homepageUrl },
    { key: "repository", labelKey: "mcpHub.storePreviewRepository", url: card.repositoryUrl },
  ];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const url = candidate.url?.trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ key: candidate.key, labelKey: candidate.labelKey, url }];
  });
}

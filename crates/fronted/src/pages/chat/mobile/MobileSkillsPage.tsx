import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MoreHorizontal, RefreshCw, SkillIcon } from "../../../components/icons";
import { Markdown } from "../../../components/Markdown";
import { useLocale } from "../../../i18n";
import { type AppSettings, updateSkills } from "../../../lib/settings";
import {
  discoverSkills,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  readSkillText,
  type SkillSummary,
} from "../../../lib/skills";
import { MobileHubHeader, MobileHubSearch } from "./MobileHubChrome";

type MobileSkillsPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  initialSkills?: SkillSummary[];
  onOpenSidebar: () => void;
};

type SkillPreview = {
  content: string;
  loading: boolean;
  error: string;
};

export function MobileSkillsPage(props: MobileSkillsPageProps) {
  const { t } = useLocale();
  const [skills, setSkills] = useState<SkillSummary[]>(props.initialSkills ?? []);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [preview, setPreview] = useState<SkillPreview>({
    content: "",
    loading: false,
    error: "",
  });

  useEffect(() => {
    setSkills(props.initialSkills ?? []);
  }, [props.initialSkills]);

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, skills]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await discoverSkills({ force: true });
      setSkills(result.skills);
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selected) {
      setPreview({ content: "", loading: false, error: "" });
      return;
    }
    let cancelled = false;
    setPreview({
      content: selected.inlineContent ?? "",
      loading: true,
      error: "",
    });
    void readSkillText({ path: selected.skillFile, offset: 0, length: 10_000 })
      .then((result) => {
        if (!cancelled) {
          setPreview({ content: result.content, loading: false, error: "" });
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setPreview({
            content: selected.inlineContent ?? "",
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const isSelected = (skill: SkillSummary) =>
    isAlwaysEnabledSkillName(skill.name) || props.settings.skills.selected.includes(skill.name);

  const toggle = (skill: SkillSummary, enabled: boolean) => {
    if (!isUserSelectableSkill(skill)) return;
    props.setSettings((prev) => {
      const next = new Set(prev.skills.selected);
      if (enabled) next.add(skill.name);
      else next.delete(skill.name);
      return updateSkills(prev, {
        enabled: enabled ? true : prev.skills.enabled,
        selected: Array.from(next),
      });
    });
  };

  if (selected) {
    return (
      <VStack as="section" gap={0} height="100%" minHeight={0}>
        <HStack
          as="header"
          gap={3}
          vAlign="center"
          paddingInline={3}
          minHeight="var(--xgent-mobile-header-height)"
          className="shrink-0 border-b border-border/40 pt-[env(safe-area-inset-top,0)]"
        >
          <IconButton
            label={t("settings.close")}
            tooltip={t("settings.close")}
            icon={<ArrowLeft />}
            variant="ghost"
            size="lg"
            onClick={() => setSelected(null)}
          />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={2} maxLines={1}>
                {selected.name}
              </Heading>
              <Text type="supporting" color="secondary" maxLines={1}>
                {selected.skillFile}
              </Text>
            </VStack>
          </StackItem>
          <Switch
            value={isSelected(selected)}
            isDisabled={!isUserSelectableSkill(selected)}
            label={isSelected(selected) ? t("settings.disable") : t("settings.enable")}
            isLabelHidden
            onChange={(checked) => toggle(selected, checked)}
            size="md"
          />
        </HStack>
        <StackItem size="fill" isScrollable>
          <VStack gap={4} padding={5}>
            {selected.description ? (
              <Text type="body" color="secondary">
                {selected.description}
              </Text>
            ) : null}
            {preview.loading ? <Spinner label={t("settings.skillsScanning")} size="md" /> : null}
            {preview.error ? (
              <Banner status="error" title={preview.error} collapsible={false} />
            ) : null}
            {preview.content ? <Markdown content={preview.content} /> : null}
          </VStack>
        </StackItem>
      </VStack>
    );
  }

  return (
    <VStack as="section" gap={0} height="100%" minHeight={0} className="relative">
      <MobileHubHeader
        title={t("sidebar.mobile.plugins")}
        onOpenSidebar={props.onOpenSidebar}
        trailing={
          <IconButton
            label={t("settings.skillsRescan")}
            tooltip={t("settings.skillsRescan")}
            icon={<RefreshCw />}
            variant="ghost"
            size="lg"
            isLoading={refreshing}
            isDisabled={refreshing}
            onClick={() => void refresh()}
          />
        }
      />
      <MobileHubSearch
        value={query}
        onChange={setQuery}
        placeholder={t("sidebar.mobile.searchPlugins")}
      />
      {refreshError ? (
        <HStack paddingInline={5} paddingBlockStart={3}>
          <Banner status="error" title={refreshError} collapsible={false} />
        </HStack>
      ) : null}

      <HStack gap={2} hAlign="between" vAlign="center" paddingInline={5} paddingBlockStart={5}>
        <Heading level={2}>{t("settings.skillsHubInstalledTab")}</Heading>
        <Badge label={String(visibleSkills.length)} />
      </HStack>

      <StackItem size="fill" isScrollable>
        <VStack gap={3} padding={3} className="mobile-hub-scroll-content">
          {visibleSkills.length > 0 ? (
            <List density="spacious">
              {visibleSkills.map((skill) => (
                <ListItem
                  key={`${skill.baseDir}:${skill.name}`}
                  label={skill.name}
                  description={skill.description}
                  startContent={<SkillIcon />}
                  endContent={<MoreHorizontal />}
                  onClick={() => setSelected(skill)}
                  isSelected={isSelected(skill)}
                />
              ))}
            </List>
          ) : !refreshing ? (
            <EmptyState icon={<MoreHorizontal />} title={t("settings.skillsNotFound")} isCompact />
          ) : (
            <Spinner label={t("settings.skillsScanning")} size="md" />
          )}
        </VStack>
      </StackItem>
    </VStack>
  );
}

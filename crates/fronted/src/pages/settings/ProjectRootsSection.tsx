import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { invoke } from "@xagent/runtime";
import { useEffect, useMemo, useState } from "react";
import { FolderTree, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  updateWorkspaceResourceSettings,
  type WorkspaceProject,
  workspaceProjectPathKey,
} from "../../lib/settings";
import { discoverSkills, type SkillSummary } from "../../lib/skills";
import {
  applyWorkspaceRootGrants,
  listWorkspaceRootGrants,
  revokeWorkspaceRootGrants,
  type WorkspaceRootAccess,
  type WorkspaceRootGrantDraft,
  type WorkspaceRootGrantState,
} from "../../lib/workspaceRootGrants";
import type { SettingsSectionProps } from "./types";

type EditableRoot = WorkspaceRootGrantDraft & {
  localId: string;
  state?: WorkspaceRootGrantState;
};

function pathAlias(path: string, used: ReadonlySet<string>) {
  const leaf =
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? "root";
  let base = leaf
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 24);
  if (!base || ["workspace", "skill", "uploads", "external"].includes(base)) base = "root";
  let alias = base;
  let suffix = 2;
  while (used.has(alias)) {
    alias = `${base.slice(0, Math.max(1, 31 - String(suffix).length))}-${suffix}`;
    suffix += 1;
  }
  return alias;
}

export function ProjectRootsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const projects = useMemo(
    () => settings.system.workspaceProjects.filter((project) => project.path.trim()),
    [settings.system.workspaceProjects],
  );
  const initialProjectId =
    projects.find((project) => project.id === settings.system.activeWorkspaceProjectId)?.id ??
    projects[0]?.id ??
    "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [roots, setRoots] = useState<EditableRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [resourceMode, setResourceMode] = useState<"inherit" | "custom">("inherit");
  const [resourceSkillNames, setResourceSkillNames] = useState<string[]>([]);
  const [resourceMcpServerIds, setResourceMcpServerIds] = useState<string[]>([]);
  const project: WorkspaceProject | undefined = projects.find((item) => item.id === projectId);

  useEffect(() => {
    let active = true;
    void discoverSkills()
      .then((result) => {
        if (active) setAvailableSkills(result.skills);
      })
      .catch(() => {
        if (active) setAvailableSkills([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (projects.some((item) => item.id === projectId)) return;
    setProjectId(initialProjectId);
  }, [initialProjectId, projectId, projects]);

  useEffect(() => {
    let active = true;
    if (!project) {
      setRoots([]);
      return;
    }
    setLoading(true);
    setError(null);
    void listWorkspaceRootGrants(project)
      .then((grants) => {
        if (!active) return;
        setRoots(
          grants.map((grant) => ({
            id: grant.id,
            localId: grant.id,
            alias: grant.alias,
            displayPath: grant.displayPath,
            access: grant.access,
            state: grant.state,
          })),
        );
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project]);

  useEffect(() => {
    const pathKey = workspaceProjectPathKey(project?.path);
    const configured = pathKey ? settings.system.workspaceResourceSettings[pathKey] : undefined;
    setResourceMode(configured?.mode === "custom" ? "custom" : "inherit");
    setResourceSkillNames(configured?.mode === "custom" ? configured.skillNames : []);
    setResourceMcpServerIds(configured?.mode === "custom" ? configured.mcpServerIds : []);
  }, [project?.path, settings.system.workspaceResourceSettings]);

  const addRoot = async () => {
    const picked = await invoke<string | null>("system_pick_folder", {
      title: t("settings.projectRoots.pick"),
    });
    if (!picked) return;
    const used = new Set(roots.map((root) => root.alias));
    setRoots((previous) => [
      ...previous,
      {
        localId: `draft-${crypto.randomUUID()}`,
        alias: pathAlias(picked, used),
        displayPath: picked,
        access: "read",
      },
    ]);
  };

  const updateRoot = (localId: string, next: Partial<EditableRoot>) => {
    setRoots((previous) =>
      previous.map((root) => (root.localId === localId ? { ...root, ...next } : root)),
    );
  };

  const save = async () => {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await applyWorkspaceRootGrants(
        project,
        roots.map((root) => ({
          ...(root.id ? { id: root.id } : {}),
          alias: root.alias.trim(),
          displayPath: root.displayPath.trim(),
          access: root.access,
        })),
      );
      setRoots(
        saved.map((grant) => ({
          id: grant.id,
          localId: grant.id,
          alias: grant.alias,
          displayPath: grant.displayPath,
          access: grant.access,
          state: grant.state,
        })),
      );
      setSettings((previous) =>
        updateWorkspaceResourceSettings(previous, project.path, {
          mode: resourceMode,
          skillNames: resourceSkillNames,
          mcpServerIds: resourceMcpServerIds,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!project) return;
    setSaving(true);
    setError(null);
    try {
      await revokeWorkspaceRootGrants(project);
      setRoots([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const skillOptions = Array.from(
    new Set([...availableSkills.map((skill) => skill.name), ...resourceSkillNames]),
  ).map((name) => ({ value: name, label: name }));

  const mcpOptions = settings.mcp.servers.map((server) => ({
    value: server.id,
    label: server.enabled ? server.id : `${server.id} — ${t("settings.projectRoots.disabled")}`,
    disabled: !server.enabled,
  }));

  return (
    <VStack gap={4} width="100%">
      <Section variant="transparent" padding={0}>
        <VStack gap={3}>
          <HStack gap={3} vAlign="center">
            <Icon icon={FolderTree} size="md" color="accent" />
            <StackItem size="fill">
              <VStack gap={0.5}>
                <Text type="label" weight="semibold">
                  {t("settings.projectRoots.title")}
                </Text>
                <Text type="supporting" color="secondary">
                  {t("settings.projectRoots.desc")}
                </Text>
              </VStack>
            </StackItem>
          </HStack>
          <Selector
            label={t("settings.projectRoots.project")}
            value={projectId}
            onChange={setProjectId}
            options={projects.map((item) => ({
              value: item.id,
              label: `${item.name} — ${item.path}`,
            }))}
            width="100%"
          />
        </VStack>
      </Section>

      <Section variant="transparent" padding={0} dividers={["top"]}>
        <VStack gap={3}>
          <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
            <Text type="label" weight="semibold">
              {t("settings.projectRoots.grants")}
            </Text>
            <Button
              label={t("settings.projectRoots.add")}
              icon={<Icon icon={FolderTree} size="sm" color="inherit" />}
              variant="secondary"
              size="sm"
              isDisabled={!project || loading || saving}
              onClick={addRoot}
            />
          </HStack>

          {loading ? (
            <HStack gap={2} vAlign="center">
              <Spinner size="sm" label={t("settings.loading")} />
              <Text type="supporting" color="secondary">
                {t("settings.loading")}
              </Text>
            </HStack>
          ) : roots.length === 0 ? (
            <EmptyState
              title={
                projects.length === 0
                  ? t("settings.projectRoots.noProjects")
                  : t("settings.projectRoots.empty")
              }
              icon={<Icon icon={FolderTree} size="lg" color="secondary" />}
              isCompact
            />
          ) : (
            <List density="balanced" hasDividers header={t("settings.projectRoots.grants")}>
              {roots.map((root) => (
                <ListItem
                  key={root.localId}
                  label={root.alias || root.displayPath}
                  startContent={<Icon icon={FolderTree} size="sm" color="secondary" />}
                  description={
                    <VStack gap={2}>
                      <FormLayout direction="horizontal">
                        <TextInput
                          label={t("settings.projectRoots.path")}
                          value={root.displayPath}
                          onChange={(displayPath) => updateRoot(root.localId, { displayPath })}
                        />
                        <TextInput
                          label={t("settings.projectRoots.alias")}
                          value={root.alias}
                          onChange={(alias) =>
                            updateRoot(root.localId, { alias: alias.slice(0, 32) })
                          }
                        />
                        <Selector
                          label={t("settings.projectRoots.read")}
                          value={root.access}
                          options={[
                            { value: "read", label: t("settings.projectRoots.read") },
                            { value: "write", label: t("settings.projectRoots.write") },
                          ]}
                          onChange={(access) =>
                            updateRoot(root.localId, {
                              access: access as WorkspaceRootAccess,
                            })
                          }
                        />
                      </FormLayout>
                      {root.state && root.state !== "active" ? (
                        <HStack gap={1} vAlign="center">
                          <StatusDot
                            variant="warning"
                            label={t(`settings.projectRoots.state.${root.state}`)}
                          />
                          <Text type="supporting" color="secondary">
                            {t(`settings.projectRoots.state.${root.state}`)}
                          </Text>
                        </HStack>
                      ) : null}
                    </VStack>
                  }
                  endContent={
                    <IconButton
                      label={t("settings.projectRoots.remove")}
                      tooltip={t("settings.projectRoots.remove")}
                      icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        setRoots((previous) =>
                          previous.filter((item) => item.localId !== root.localId),
                        )
                      }
                    />
                  }
                />
              ))}
            </List>
          )}
        </VStack>
      </Section>

      <Section variant="transparent" padding={0} dividers={["top"]}>
        <VStack gap={3}>
          <VStack gap={0.5}>
            <Text type="label" weight="semibold">
              {t("settings.projectRoots.resources")}
            </Text>
            <Text type="supporting" color="secondary">
              {t("settings.projectRoots.resourcesDesc")}
            </Text>
          </VStack>
          <SegmentedControl
            label={t("settings.projectRoots.resources")}
            value={resourceMode}
            layout="fill"
            onChange={(mode) => setResourceMode(mode as "inherit" | "custom")}
          >
            <SegmentedControlItem
              value="inherit"
              label={t("settings.projectRoots.resources.inherit")}
            />
            <SegmentedControlItem
              value="custom"
              label={t("settings.projectRoots.resources.custom")}
            />
          </SegmentedControl>
          {resourceMode === "custom" ? (
            <Grid columns={{ minWidth: 280, max: 2, repeat: "fit" }} gap={3} width="100%">
              <MultiSelector
                label={t("settings.projectRoots.skills")}
                options={skillOptions}
                value={resourceSkillNames}
                onChange={setResourceSkillNames}
                placeholder={t("settings.projectRoots.resourcesEmpty")}
                triggerDisplay="count"
                hasSearch={skillOptions.length > 15}
                hasSelectAll
                hasClear
                width="100%"
              />
              <MultiSelector
                label={t("settings.projectRoots.mcp")}
                options={mcpOptions}
                value={resourceMcpServerIds}
                onChange={setResourceMcpServerIds}
                placeholder={t("settings.projectRoots.resourcesEmpty")}
                triggerDisplay="count"
                hasSearch={mcpOptions.length > 15}
                hasSelectAll
                hasClear
                width="100%"
              />
            </Grid>
          ) : null}
        </VStack>
      </Section>

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}

      <HStack gap={2} hAlign="end" wrap="wrap">
        <Button
          label={t("settings.projectRoots.revoke")}
          variant="secondary"
          isDisabled={!project || saving}
          onClick={revoke}
        />
        <Button
          label={t("settings.save")}
          variant="primary"
          isLoading={saving}
          isDisabled={!project || saving}
          onClick={save}
        />
      </HStack>
    </VStack>
  );
}

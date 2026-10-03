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
import { invoke } from "@xgent/runtime";
import { useEffect, useMemo, useState } from "react";
import { FolderTree, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import {
  updateWorkspaceResourceSettings,
  type WorkspaceProject,
  workspaceProjectPathKey,
} from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import { discoverSkills, type SkillSummary } from "../../lib/skills";
import {
  applyWorkspaceRootGrants,
  listWorkspaceRootGrants,
  revokeWorkspaceRootGrants,
  type WorkspaceRootAccess,
  type WorkspaceRootGrantDraft,
  type WorkspaceRootGrantState,
} from "../../lib/workspaceRootGrants";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
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

type ProjectRootsSectionProps = SettingsSectionProps & {
  selectedProjectId?: string;
  showProjectSelector?: boolean;
  onBack?: () => void;
};

export function ProjectRootsSection({
  settings,
  setSettings,
  selectedProjectId,
  showProjectSelector = true,
  nativeSettingsSurfaceId,
  onBack,
}: ProjectRootsSectionProps) {
  const { t } = useLocale();
  const projects = useMemo(
    () => settings.system.workspaceProjects.filter((project) => project.path.trim()),
    [settings.system.workspaceProjects],
  );
  const initialProjectId =
    projects.find((project) => project.id === selectedProjectId)?.id ??
    projects.find((project) => project.id === settings.system.activeWorkspaceProjectId)?.id ??
    projects[0]?.id ??
    "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [roots, setRoots] = useState<EditableRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [resourceMode, setResourceMode] = useState<"inherit" | "custom">("inherit");
  const [resourceSkillNames, setResourceSkillNames] = useState<string[]>([]);
  const [resourceMcpServerIds, setResourceMcpServerIds] = useState<string[]>([]);
  const project: WorkspaceProject | undefined = projects.find((item) => item.id === projectId);
  const [scope] = useState(() => ({ key: "", revision: 0, active: true, busy: false }));
  const scopeKey = `${project?.id ?? ""}\n${project?.path ?? ""}`;
  if (scope.key !== scopeKey) {
    scope.key = scopeKey;
    scope.revision++;
    scope.busy = false;
  }
  useEffect(() => {
    scope.active = true;
    setPicking(false);
    setSaving(false);
    return () => {
      scope.active = false;
      scope.revision++;
    };
  }, [scopeKey]);

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
    if (selectedProjectId && projects.some((item) => item.id === selectedProjectId)) {
      if (projectId !== selectedProjectId) setProjectId(selectedProjectId);
      return;
    }
    if (projects.some((item) => item.id === projectId)) return;
    setProjectId(initialProjectId);
  }, [initialProjectId, projectId, projects, selectedProjectId]);

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
    if (!project || loading || scope.busy || !scope.active) return;
    const revision = scope.revision;
    const current = () => scope.active && scope.revision === revision;
    scope.busy = true;
    setPicking(true);
    setError(null);
    try {
      const picked = await invoke<string | null>("system_pick_folder", {
        title: t("settings.projectRoots.pick"),
      });
      if (!picked || !current()) return;
      setRoots((previous) => [
        ...previous,
        {
          localId: `draft-${createUuid()}`,
          alias: pathAlias(picked, new Set(previous.map((root) => root.alias))),
          displayPath: picked,
          access: "read",
        },
      ]);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) {
        scope.busy = false;
        setPicking(false);
      }
    }
  };

  const updateRoot = (localId: string, next: Partial<EditableRoot>) => {
    setRoots((previous) =>
      previous.map((root) => (root.localId === localId ? { ...root, ...next } : root)),
    );
  };

  const save = async () => {
    if (!project || loading || scope.busy || !scope.active) return;
    const revision = scope.revision;
    const current = () => scope.active && scope.revision === revision;
    scope.busy = true;
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
      if (current())
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
      if (current()) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) {
        scope.busy = false;
        setSaving(false);
      }
    }
  };

  const revoke = async () => {
    if (!project || loading || scope.busy || !scope.active) return;
    const revision = scope.revision;
    const current = () => scope.active && scope.revision === revision;
    scope.busy = true;
    setSaving(true);
    setError(null);
    try {
      await revokeWorkspaceRootGrants(project);
      if (current()) setRoots([]);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current()) {
        scope.busy = false;
        setSaving(false);
      }
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

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    const editable = !!project && !loading && !saving && !picking;
    const nodes: PresentationNode[] = [
      {
        id: "roots-description",
        kind: "Text",
        text: t("settings.projectRoots.desc"),
        secondary: true,
      },
      ...(showProjectSelector
        ? [
            c.select(
              "roots-project",
              t("settings.projectRoots.project"),
              projectId,
              projects.map((item) => ({ value: item.id, label: `${item.name} — ${item.path}` })),
              setProjectId,
              !saving && !picking,
            ),
          ]
        : []),
      ...(project
        ? [
            {
              id: "roots-project-path",
              kind: "Text" as const,
              text: `${project.name}\n${project.path}`,
              secondary: true,
            },
          ]
        : []),
      c.action("roots-add", t("settings.projectRoots.add"), addRoot, editable),
      ...(loading
        ? [{ id: "roots-loading", kind: "Progress" as const, label: t("settings.loading") }]
        : []),
      ...roots.map((root) =>
        c.group(`root:${root.localId}`, root.alias || root.displayPath, [
          c.input(
            `root:${root.localId}:path`,
            t("settings.projectRoots.path"),
            root.displayPath,
            (displayPath) => updateRoot(root.localId, { displayPath }),
            false,
            editable,
          ),
          c.input(
            `root:${root.localId}:alias`,
            t("settings.projectRoots.alias"),
            root.alias,
            (alias) => updateRoot(root.localId, { alias }),
            false,
            editable,
            (value) => value.slice(0, 32),
          ),
          c.select(
            `root:${root.localId}:access`,
            t("settings.projectRoots.grants"),
            root.access,
            [
              { value: "read", label: t("settings.projectRoots.read") },
              { value: "write", label: t("settings.projectRoots.write") },
            ],
            (access) => updateRoot(root.localId, { access: access as WorkspaceRootAccess }),
            editable,
          ),
          ...(root.state && root.state !== "active"
            ? [
                {
                  id: `root:${root.localId}:status`,
                  kind: "StatusDot" as const,
                  status: "pending" as const,
                  label: t(`settings.projectRoots.state.${root.state}`),
                },
              ]
            : []),
          {
            ...c.action(
              `root:${root.localId}:remove`,
              t("settings.projectRoots.remove"),
              () =>
                setRoots((previous) => previous.filter((item) => item.localId !== root.localId)),
              editable,
            ),
            destructive: true,
          },
        ]),
      ),
      ...(!loading && !roots.length
        ? [
            {
              id: "roots-empty",
              kind: "EmptyState" as const,
              icon: "folder",
              label: t(
                projects.length
                  ? "settings.projectRoots.empty"
                  : "settings.projectRoots.noProjects",
              ),
            },
          ]
        : []),
      c.group("roots-resources", t("settings.projectRoots.resources"), [
        {
          id: "roots-resources-description",
          kind: "Text",
          text: t("settings.projectRoots.resourcesDesc"),
          secondary: true,
        },
        c.select(
          "roots-resource-mode",
          t("settings.projectRoots.resources"),
          resourceMode,
          [
            { value: "inherit", label: t("settings.projectRoots.resources.inherit") },
            { value: "custom", label: t("settings.projectRoots.resources.custom") },
          ],
          (mode) => setResourceMode(mode as "inherit" | "custom"),
          editable,
        ),
        ...(resourceMode === "custom"
          ? [
              c.group("roots-skills", t("settings.projectRoots.skills"), [
                c.action(
                  "roots-skills-all",
                  t("settings.selectAll"),
                  () => setResourceSkillNames(skillOptions.map((option) => option.value)),
                  editable,
                ),
                c.action(
                  "roots-skills-clear",
                  t("skills.clearSelection"),
                  () => setResourceSkillNames([]),
                  editable,
                ),
                ...skillOptions.map((option) =>
                  c.toggle(
                    `roots-skill:${option.value}`,
                    option.label,
                    resourceSkillNames.includes(option.value),
                    (selected) =>
                      setResourceSkillNames((previous) =>
                        selected
                          ? [...new Set([...previous, option.value])]
                          : previous.filter((name) => name !== option.value),
                      ),
                    editable,
                  ),
                ),
              ]),
              c.group("roots-mcp", t("settings.projectRoots.mcp"), [
                c.action(
                  "roots-mcp-all",
                  t("settings.selectAll"),
                  () =>
                    setResourceMcpServerIds(
                      mcpOptions.filter((option) => !option.disabled).map((option) => option.value),
                    ),
                  editable,
                ),
                c.action(
                  "roots-mcp-clear",
                  t("skills.clearSelection"),
                  () => setResourceMcpServerIds([]),
                  editable,
                ),
                ...mcpOptions.map((option) =>
                  c.toggle(
                    `roots-mcp:${option.value}`,
                    option.label,
                    resourceMcpServerIds.includes(option.value),
                    (selected) =>
                      setResourceMcpServerIds((previous) =>
                        selected
                          ? [...new Set([...previous, option.value])]
                          : previous.filter((id) => id !== option.value),
                      ),
                    editable && !option.disabled,
                  ),
                ),
              ]),
            ]
          : []),
      ]),
      ...(error
        ? [{ id: "roots-error", kind: "Banner" as const, label: error, status: "error" as const }]
        : []),
      {
        ...c.action("roots-revoke", t("settings.projectRoots.revoke"), revoke, editable),
        destructive: true,
      },
      { ...c.action("roots-save", t("settings.save"), save, editable), prominent: true },
      ...(saving
        ? [{ id: "roots-saving", kind: "Progress" as const, label: t("settings.saving") }]
        : []),
    ];
    c.handlers.set("close", {
      enabled: !saving && !picking,
      accepts: (value) => value === null,
      run: () => onBack?.(),
    });
    return (
      <NativeSurface
        sessionSurface={nativeSettingsSurfaceId}
        document={{
          mode: "sheet",
          title: t("settings.projectRoots.title"),
          appearance: settings.theme,
          formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, isNativeMobileRuntime()),
          nodes,
          dismissAction: saving || picking ? undefined : "close",
        }}
        handlers={c.handlers}
        onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
      />
    );
  }

  return (
    <VStack gap={4} width="100%">
      {showProjectSelector ? (
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
      ) : null}

      <Section variant="transparent" padding={0} dividers={["top"]}>
        <VStack gap={3}>
          <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
            <Text type="label" weight="semibold">
              {t("settings.projectRoots.grants")}
            </Text>
            <Button
              label={t("settings.projectRoots.add")}
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

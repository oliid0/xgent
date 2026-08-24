import { invoke } from "@xagent/runtime";
import { useEffect, useMemo, useState } from "react";
import { FolderTree, Loader2, Trash2 } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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

  const updateRoot = (localId: string, patch: Partial<EditableRoot>) => {
    setRoots((previous) =>
      previous.map((root) => (root.localId === localId ? { ...root, ...patch } : root)),
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
      setSettings((prev) =>
        updateWorkspaceResourceSettings(prev, project.path, {
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

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
            <FolderTree className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("settings.projectRoots.title")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.projectRoots.desc")}
            </p>
          </div>
        </div>
        <label className="mt-4 block space-y-1.5 text-xs text-muted-foreground">
          <span>{t("settings.projectRoots.project")}</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.path}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("settings.projectRoots.grants")}</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={!project || loading || saving}
            onClick={addRoot}
          >
            <FolderTree className="mr-1.5 h-4 w-4" />
            {t("settings.projectRoots.add")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.loading")}
          </div>
        ) : roots.length === 0 ? (
          <p className="mt-3 rounded-xl bg-muted/45 px-3 py-3 text-xs text-muted-foreground">
            {projects.length === 0
              ? t("settings.projectRoots.noProjects")
              : t("settings.projectRoots.empty")}
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {roots.map((root) => (
              <div key={root.localId} className="rounded-xl border border-border/50 p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("settings.projectRoots.path")}</span>
                    <Input
                      value={root.displayPath}
                      onChange={(event) =>
                        updateRoot(root.localId, { displayPath: event.target.value })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("settings.projectRoots.alias")}</span>
                    <Input
                      value={root.alias}
                      maxLength={32}
                      onChange={(event) => updateRoot(root.localId, { alias: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setRoots((previous) =>
                        previous.filter((item) => item.localId !== root.localId),
                      )
                    }
                    className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("settings.projectRoots.remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {(["read", "write"] as const).map((access: WorkspaceRootAccess) => (
                    <button
                      key={access}
                      type="button"
                      onClick={() => updateRoot(root.localId, { access })}
                      className={`rounded-lg px-2.5 py-1 text-xs ${
                        root.access === access
                          ? "bg-cyan-500/12 text-cyan-700 ring-1 ring-cyan-500/25 dark:text-cyan-300"
                          : "bg-muted/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(`settings.projectRoots.${access}`)}
                    </button>
                  ))}
                  {root.state && root.state !== "active" ? (
                    <span className="text-xs text-amber-600 dark:text-amber-300">
                      {t(`settings.projectRoots.state.${root.state}`)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 border-t border-border/50 pt-4">
          <h3 className="text-sm font-semibold">{t("settings.projectRoots.resources")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("settings.projectRoots.resourcesDesc")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["inherit", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setResourceMode(mode)}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  resourceMode === mode
                    ? "bg-cyan-500/12 text-cyan-700 ring-1 ring-cyan-500/25 dark:text-cyan-300"
                    : "bg-muted/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`settings.projectRoots.resources.${mode}`)}
              </button>
            ))}
          </div>
          {resourceMode === "custom" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium">{t("settings.projectRoots.skills")}</div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/50 p-2">
                  {Array.from(
                    new Set([...availableSkills.map((skill) => skill.name), ...resourceSkillNames]),
                  ).map((name) => (
                    <label
                      key={name}
                      className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={resourceSkillNames.includes(name)}
                        onChange={(event) =>
                          setResourceSkillNames((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, name]))
                              : current.filter((item) => item !== name),
                          )
                        }
                      />
                      <span className="min-w-0 truncate">{name}</span>
                    </label>
                  ))}
                  {availableSkills.length === 0 && resourceSkillNames.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      {t("settings.projectRoots.resourcesEmpty")}
                    </p>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium">{t("settings.projectRoots.mcp")}</div>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/50 p-2">
                  {settings.mcp.servers.map((server) => (
                    <label
                      key={server.id}
                      className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={resourceMcpServerIds.includes(server.id)}
                        disabled={!server.enabled}
                        onChange={(event) =>
                          setResourceMcpServerIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, server.id]))
                              : current.filter((item) => item !== server.id),
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{server.id}</span>
                      {!server.enabled ? (
                        <span className="text-[10px] text-muted-foreground">
                          {t("settings.projectRoots.disabled")}
                        </span>
                      ) : null}
                    </label>
                  ))}
                  {settings.mcp.servers.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                      {t("settings.projectRoots.resourcesEmpty")}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" disabled={!project || saving} onClick={revoke}>
            {t("settings.projectRoots.revoke")}
          </Button>
          <Button disabled={!project || saving} onClick={save}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("settings.save")}
          </Button>
        </div>
      </section>
    </div>
  );
}

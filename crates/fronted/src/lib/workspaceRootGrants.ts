import { invoke } from "@xagent/runtime";
import type { WorkspaceProject } from "./settings";
import { isWindowsDrivePath, normalizeComparablePath } from "./tools/pathNormalization";

export type WorkspaceRootAccess = "read" | "write";
export type WorkspaceRootGrantState = "active" | "missing" | "changed";

export type WorkspaceRootGrant = {
  id: string;
  projectId: string;
  projectPathKey: string;
  alias: string;
  displayPath: string;
  canonicalPath: string;
  access: WorkspaceRootAccess;
  state: WorkspaceRootGrantState;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceRootGrantDraft = {
  id?: string;
  alias: string;
  displayPath: string;
  access: WorkspaceRootAccess;
};

function commandArgs(project: Pick<WorkspaceProject, "id" | "path">) {
  return {
    projectId: project.id,
    projectPath: project.path,
  };
}

export async function listWorkspaceRootGrants(project: Pick<WorkspaceProject, "id" | "path">) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_list", commandArgs(project));
}

export async function applyWorkspaceRootGrants(
  project: Pick<WorkspaceProject, "id" | "path">,
  grants: readonly WorkspaceRootGrantDraft[],
) {
  return invoke<WorkspaceRootGrant[]>("workspace_root_grants_apply", {
    ...commandArgs(project),
    grants,
  });
}

export async function revokeWorkspaceRootGrants(project: Pick<WorkspaceProject, "id">) {
  await invoke("workspace_root_grants_revoke", {
    projectId: project.id,
  });
}

export type DroppedWorkspaceRootDraftResult = {
  drafts: WorkspaceRootGrantDraft[];
  addedPaths: string[];
  skippedInsideWorkspace: string[];
  skippedOverlapping: string[];
};

function comparablePath(value: string) {
  const normalized = normalizeComparablePath(value);
  return isWindowsDrivePath(normalized) ? normalized.toLowerCase() : normalized;
}

function pathContains(parent: string, child: string) {
  return child === parent || child.startsWith(`${parent}/`);
}

function droppedRootAlias(path: string, used: ReadonlySet<string>) {
  const leaf = normalizeComparablePath(path).split("/").filter(Boolean).pop() ?? "root";
  let base = leaf
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 24);
  if (!base || ["workspace", "skill", "uploads", "external"].includes(base)) base = "root";
  let alias = base;
  let suffix = 2;
  while (used.has(alias)) {
    const suffixText = `-${suffix}`;
    alias = `${base.slice(0, Math.max(1, 32 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  return alias;
}

/**
 * Builds the complete grant transaction for folders dropped on the composer.
 * Existing grants retain their ids, and unsafe/redundant overlaps are skipped
 * before the backend performs the authoritative canonical-path validation.
 */
export function buildDroppedWorkspaceRootDrafts(params: {
  projectPath: string;
  existingGrants: readonly WorkspaceRootGrant[];
  folderPaths: readonly string[];
}): DroppedWorkspaceRootDraftResult {
  const { projectPath, existingGrants, folderPaths } = params;
  const primary = comparablePath(projectPath);
  const usedAliases = new Set(existingGrants.map((grant) => grant.alias.toLowerCase()));
  const acceptedPaths = existingGrants.map((grant) => comparablePath(grant.canonicalPath));
  const drafts: WorkspaceRootGrantDraft[] = existingGrants.map((grant) => ({
    id: grant.id,
    alias: grant.alias,
    displayPath: grant.displayPath,
    access: grant.access,
  }));
  const result: DroppedWorkspaceRootDraftResult = {
    drafts,
    addedPaths: [],
    skippedInsideWorkspace: [],
    skippedOverlapping: [],
  };

  for (const folderPath of folderPaths) {
    const path = comparablePath(folderPath);
    if (!path) continue;
    if (primary && pathContains(primary, path)) {
      result.skippedInsideWorkspace.push(folderPath);
      continue;
    }
    if (
      acceptedPaths.some((existing) => pathContains(existing, path) || pathContains(path, existing))
    ) {
      result.skippedOverlapping.push(folderPath);
      continue;
    }
    const alias = droppedRootAlias(folderPath, usedAliases);
    usedAliases.add(alias);
    acceptedPaths.push(path);
    drafts.push({ alias, displayPath: folderPath, access: "read" });
    result.addedPaths.push(folderPath);
  }
  return result;
}

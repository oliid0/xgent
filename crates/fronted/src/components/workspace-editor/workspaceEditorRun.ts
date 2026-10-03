/** Identical runnable-file policy and command quoting for both presentations. */
export function runnableWorkspaceFile(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  const fileName = normalized.slice(separator + 1);
  if (!/^[\p{L}\p{N} ._()-]+$/u.test(fileName)) return null;
  const lowerName = fileName.toLowerCase();
  const executable = lowerName.endsWith(".py")
    ? "python"
    : /\.(?:js|mjs|cjs)$/.test(lowerName)
      ? "node"
      : null;
  if (!executable) return null;
  return {
    fileName,
    command: `${executable} -- "${fileName}"`,
    cwd: separator > 0 ? normalized.slice(0, separator) : null,
  };
}

export function workspaceEditorRunStatus(result: {
  phase: "running" | "complete" | "failed";
  exitCode?: number;
  timedOut?: boolean;
  cancelled?: boolean;
}) {
  if (result.phase === "running")
    return { label: "workspaceEditor.running", status: "running" } as const;
  if (result.cancelled)
    return { label: "workspaceEditor.runCancelled", status: "warning" } as const;
  if (result.timedOut) return { label: "workspaceEditor.runTimedOut", status: "error" } as const;
  if (result.phase === "failed" || result.exitCode !== 0)
    return { label: "workspaceEditor.runFailed", status: "error" } as const;
  return { label: "workspaceEditor.runSucceeded", status: "success" } as const;
}

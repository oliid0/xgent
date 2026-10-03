import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeFs } from "../../lib/tools/fsBackend";

export type WorkspaceFileApplication = { id: string; label: string };

export function workspaceFileApplications(value: unknown): WorkspaceFileApplication[] {
  if (!Array.isArray(value)) throw new Error("Invalid application list");
  const seen = new Set<string>();
  const applications: WorkspaceFileApplication[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.includes("\0") ||
      typeof item.label !== "string" ||
      !item.label.trim()
    ) {
      throw new Error("Invalid application list");
    }
    if (!seen.has(item.id)) {
      seen.add(item.id);
      applications.push({ id: item.id, label: item.label });
    }
  }
  return applications;
}

/** Shared discovery/open lifetime; Rust validates the actual path and registered handler. */
export function useWorkspaceFileApplications({
  workdir,
  path,
  enabled = true,
  onError,
}: {
  workdir: string;
  path: string;
  enabled?: boolean;
  onError: (message: string) => void;
}) {
  const owner = useMemo(() => ({ workdir, path, enabled }), [workdir, path, enabled]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const mounted = useRef(false);
  const scan = useRef(0);
  const openingRef = useRef(false),
    loadingRef = useRef(false);
  const applicationsRef = useRef<WorkspaceFileApplication[]>([]);
  const [applications, setApplications] = useState<WorkspaceFileApplication[]>([]);
  const [loading, setLoading] = useState(false),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    mounted.current = true;
    loadingRef.current = false;
    openingRef.current = false;
    applicationsRef.current = [];
    setApplications([]);
    setLoading(false);
    setOpening(false);
    return () => {
      mounted.current = false;
      scan.current++;
    };
  }, [owner]);

  const isCurrent = useCallback(
    () =>
      mounted.current &&
      ownerRef.current === owner &&
      owner.enabled &&
      !!owner.path &&
      !!owner.workdir,
    [owner],
  );
  const load = useCallback(async () => {
    if (!isCurrent() || loadingRef.current) return false;
    loadingRef.current = true;
    const request = ++scan.current;
    setLoading(true);
    try {
      const applications = workspaceFileApplications(
        await invokeFs<unknown>("fs_file_applications", {
          workdir: owner.workdir,
          path: owner.path,
        }),
      );
      if (!isCurrent() || scan.current !== request) return false;
      applicationsRef.current = applications;
      setApplications(applications);
      return true;
    } catch (error) {
      if (isCurrent() && scan.current === request) onErrorRef.current(String(error));
      return false;
    } finally {
      if (isCurrent() && scan.current === request) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [owner, isCurrent]);
  const acceptsMode = useCallback(
    (mode: unknown): mode is string =>
      typeof mode === "string" &&
      (["open", "choose", "reveal"].includes(mode) ||
        (mode.startsWith("app:") &&
          applicationsRef.current.some((application) => application.id === mode.slice(4)))),
    [],
  );
  const open = useCallback(
    async (mode: unknown) => {
      if (!isCurrent() || openingRef.current || !acceptsMode(mode)) return false;
      openingRef.current = true;
      setOpening(true);
      onErrorRef.current("");
      try {
        await invokeFs("fs_open_workspace_path", {
          workdir: owner.workdir,
          path: owner.path,
          mode,
        });
        return isCurrent();
      } catch (error) {
        if (isCurrent()) onErrorRef.current(String(error));
        return false;
      } finally {
        if (isCurrent()) {
          openingRef.current = false;
          setOpening(false);
        }
      }
    },
    [owner, isCurrent, acceptsMode],
  );
  return { applications, loading, opening, load, open, acceptsMode, isCurrent };
}

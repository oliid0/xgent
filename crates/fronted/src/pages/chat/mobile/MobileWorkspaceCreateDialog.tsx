import { invoke } from "@xagent/runtime";
import { type FormEvent, useEffect, useState } from "react";
import { FolderClosed, FolderOpen, GitBranch, Loader2, Plus, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { listGitRemoteBranches, startGitClone } from "../../../lib/git/tauriGitClient";

type MobileWorkspaceCreateDialogProps = {
  open: boolean;
  parent: string;
  onCreated: (path: string, kind: "managed" | "folder") => void;
  onCloneStarted?: () => void;
  cloneAvailable?: boolean;
  onClose: () => void;
};

export function MobileWorkspaceCreateDialog(props: MobileWorkspaceCreateDialogProps) {
  const { open, parent, onCreated, onCloneStarted, cloneAvailable = false, onClose } = props;
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"new" | "clone">("new");
  const [destination, setDestination] = useState(parent);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
    setMode("new");
    setDestination(parent);
    setRemoteUrl("");
    setBranch("");
    setRemoteBranches([]);
  }, [open, parent]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || !destination || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "clone") {
        if (!remoteUrl.trim()) return;
        await startGitClone({
          parent: destination,
          name: workspaceName,
          remoteUrl: remoteUrl.trim(),
          branch: branch.trim() || undefined,
        });
        onCloneStarted?.();
      } else {
        const response = await invoke<{ path: string }>("system_create_project_folder", {
          parent: destination,
          name: workspaceName,
        });
        onCreated(response.path, "managed");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const pickDestination = async () => {
    if (busy) return;
    try {
      const selected = await invoke<string | null>("system_pick_folder", {
        initial_workdir: destination || null,
      });
      if (selected?.trim()) setDestination(selected.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const loadBranches = async () => {
    if (!remoteUrl.trim() || loadingBranches) return;
    setLoadingBranches(true);
    setError("");
    try {
      const result = await listGitRemoteBranches(remoteUrl.trim());
      setRemoteBranches(result.branches);
      if (!branch.trim()) setBranch(result.defaultBranch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingBranches(false);
    }
  };

  const pickExternal = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const selected = await invoke<string | null>("system_pick_folder", {
        initial_workdir: null,
      });
      if (selected?.trim()) onCreated(selected.trim(), "folder");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-edge-swipe-ignore
      className="fixed inset-0 z-[80] flex items-end bg-black/35 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:items-center md:justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={(event) => void submit(event)}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-xl md:max-w-lg"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/12 text-blue-500">
            <FolderClosed className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">
              {mode === "clone" ? t("chat.clone.title") : t("chat.mobileWorkspace.new")}
            </h2>
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
              {t("chat.mobileWorkspace.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            aria-label={t("chat.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {cloneAvailable ? (
          <div className="mt-4 grid grid-cols-2 rounded-xl bg-muted/60 p-1">
            {(["new", "clone"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError("");
                }}
                className={`h-9 rounded-lg text-xs font-semibold transition-colors ${mode === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {value === "new" ? t("chat.clone.newTab") : t("chat.clone.cloneTab")}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "clone" ? (
          <>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium">{t("chat.clone.remoteUrl")}</span>
              <input
                autoFocus
                value={remoteUrl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setRemoteUrl(value);
                  if (!name.trim()) {
                    const inferred = value
                      .trim()
                      .replace(/[\\/]+$/, "")
                      .split(/[\\/]/)
                      .pop()
                      ?.replace(/\.git$/i, "");
                    if (inferred) setName(inferred);
                  }
                }}
                placeholder="https://github.com/owner/repository.git"
                className="h-11 w-full rounded-2xl border border-border/60 bg-muted/35 px-3.5 text-sm outline-none focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <div className="mt-3 flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-medium">{t("chat.clone.branch")}</span>
                <input
                  list="workspace-clone-branches"
                  value={branch}
                  onChange={(event) => setBranch(event.currentTarget.value)}
                  placeholder={t("chat.clone.defaultBranch")}
                  className="h-11 w-full rounded-2xl border border-border/60 bg-muted/35 px-3.5 text-sm outline-none focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
                />
                <datalist id="workspace-clone-branches">
                  {remoteBranches.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              <button
                type="button"
                disabled={!remoteUrl.trim() || loadingBranches}
                onClick={() => void loadBranches()}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold disabled:opacity-40"
              >
                {loadingBranches ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitBranch className="h-3.5 w-3.5" />
                )}
                {t("chat.clone.loadBranches")}
              </button>
            </div>
          </>
        ) : null}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium">{t("chat.mobileWorkspace.name")}</span>
          <input
            autoFocus={mode === "new"}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={t("chat.mobileWorkspace.placeholder")}
            className="h-11 w-full rounded-2xl border border-border/60 bg-muted/35 px-3.5 text-sm outline-none focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <p
          className="mt-2 truncate px-1 font-mono text-[10px] text-muted-foreground"
          title={destination}
        >
          {destination}
        </p>
        {error ? (
          <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={!name.trim() || !destination || busy || (mode === "clone" && !remoteUrl.trim())}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {mode === "clone" ? <GitBranch className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {busy
            ? mode === "clone"
              ? t("chat.clone.starting")
              : t("chat.mobileWorkspace.creating")
            : mode === "clone"
              ? t("chat.clone.start")
              : t("chat.mobileWorkspace.create")}
        </button>
        {cloneAvailable ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void pickDestination()}
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-border/60 text-xs font-semibold active:bg-muted disabled:opacity-40"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("chat.clone.chooseDestination")}
          </button>
        ) : null}
        {mode === "new" ? (
          <>
            <div className="my-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border/50" />
              {t("chat.mobileWorkspace.or")}
              <span className="h-px flex-1 bg-border/50" />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void pickExternal()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border/60 bg-background text-sm font-semibold active:bg-muted disabled:opacity-40"
            >
              <FolderOpen className="h-4 w-4" />
              {t("chat.mobileWorkspace.chooseFolder")}
            </button>
            <p className="mt-2 px-1 text-[10.5px] leading-4 text-muted-foreground">
              {t("chat.mobileWorkspace.chooseFolderHint")}
            </p>
          </>
        ) : null}
      </form>
    </div>
  );
}

import { invoke } from "@xagent/runtime";
import { type FormEvent, useEffect, useState } from "react";
import { FolderClosed, FolderOpen, Plus, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";

type MobileWorkspaceCreateDialogProps = {
  open: boolean;
  parent: string;
  onCreated: (path: string, kind: "managed" | "folder") => void;
  onClose: () => void;
};

export function MobileWorkspaceCreateDialog(props: MobileWorkspaceCreateDialogProps) {
  const { open, parent, onCreated, onClose } = props;
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
  }, [open]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || !parent || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await invoke<{ path: string }>("system_create_project_folder", {
        parent,
        name: workspaceName,
      });
      onCreated(response.path, "managed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
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
      className="absolute inset-0 z-[80] flex items-end bg-black/25 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        onSubmit={(event) => void submit(event)}
        onClick={(event) => event.stopPropagation()}
        className="w-full overflow-hidden rounded-3xl border border-white/40 bg-background/92 p-4 shadow-2xl backdrop-blur-2xl dark:border-white/[0.09]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/12 text-blue-500">
            <FolderClosed className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">{t("chat.mobileWorkspace.new")}</h2>
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
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium">
            {t("chat.mobileWorkspace.name")}
          </span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={t("chat.mobileWorkspace.placeholder")}
            className="h-11 w-full rounded-2xl border border-border/60 bg-muted/35 px-3.5 text-sm outline-none focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <p className="mt-2 truncate px-1 font-mono text-[10px] text-muted-foreground" title={parent}>
          {parent}
        </p>
        {error ? (
          <div className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={!name.trim() || !parent || busy}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {busy ? t("chat.mobileWorkspace.creating") : t("chat.mobileWorkspace.create")}
        </button>
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
      </form>
    </div>
  );
}

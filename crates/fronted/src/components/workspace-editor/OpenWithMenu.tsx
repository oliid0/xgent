import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { invokeFs } from "../../lib/tools/fsBackend";

export function OpenWithMenu({
  workdir,
  path,
  onError,
  onPreview,
}: {
  workdir: string;
  path: string;
  onError: (message: string) => void;
  onPreview?: () => void;
}) {
  const { t } = useLocale();
  const [apps, setApps] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    setApps([]);
    setLoading(false);
    return () => {
      request.current++;
    };
  }, [workdir, path]);
  const load = async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await invokeFs<{ id: string; label: string }[]>("fs_file_applications", {
        workdir,
        path,
      });
      if (id === request.current) setApps(result);
    } catch (error) {
      if (id === request.current) onError(String(error));
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  const open = async (mode: string) => {
    setBusy(true);
    onError("");
    try {
      await invokeFs("fs_open_workspace_path", { workdir, path, mode });
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const items: DropdownMenuOption[] = [
    ...(onPreview ? [{ label: t("workspaceFilePreview.preview"), onClick: onPreview }] : []),
    ...(loading
      ? [{ label: t("common.loading"), isDisabled: true }]
      : apps.map((app) => ({
          id: app.id,
          label: app.label,
          onClick: () => void open(`app:${app.id}`),
        }))),
    { label: t("workspaceFiles.defaultApp"), onClick: () => void open("open") },
    { label: t("workspaceFiles.chooseApp"), onClick: () => void open("choose") },
    { type: "divider" },
    { label: t("workspaceFiles.revealInFinder"), onClick: () => void open("reveal") },
  ];
  return (
    <DropdownMenu
      button={{
        label: "Open with",
        variant: "ghost",
        size: "sm",
        isDisabled: busy,
        isLoading: busy,
      }}
      items={items}
      alignment="end"
      menuWidth="max-content"
      onOpenChange={(open) => {
        if (open) void load();
      }}
    />
  );
}

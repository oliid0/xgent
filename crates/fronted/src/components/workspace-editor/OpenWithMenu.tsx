import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { useLocale } from "../../i18n";
import { useWorkspaceFileApplications } from "./useWorkspaceFileApplications";

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
  const {
    applications: apps,
    loading,
    opening: busy,
    load,
    open,
    isCurrent,
  } = useWorkspaceFileApplications({ workdir, path, onError });
  const items: DropdownMenuOption[] = [
    ...(onPreview
      ? [
          {
            label: t("workspaceFilePreview.preview"),
            onClick: () => {
              if (isCurrent()) onPreview();
            },
          },
        ]
      : []),
    ...(loading
      ? [{ label: t("common.loading"), isDisabled: true }]
      : apps.map((app) => ({
          id: app.id,
          label: app.label,
          onClick: () => void open(`app:${app.id}`),
        }))),
    { label: t("workspaceFiles.defaultApp"), onClick: () => void open("open") },
    { label: t("workspaceFiles.chooseApp"), onClick: () => void open("choose") },
    {
      label: t("workspaceFiles.refreshApplications"),
      isDisabled: loading,
      onClick: () => void load(),
    },
    { type: "divider" },
    { label: t("workspaceFiles.revealInFinder"), onClick: () => void open("reveal") },
  ];
  return (
    <DropdownMenu
      button={{
        label: t("workspaceFiles.openWith"),
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

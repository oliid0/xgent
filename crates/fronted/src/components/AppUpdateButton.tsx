import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useLocale } from "../i18n";
import { type AppUpdateController, getAppUpdateDisplayVersion } from "../lib/appUpdates";
import { Download, RefreshCw } from "./icons";

type AppUpdateButtonProps = {
  appUpdate: AppUpdateController;
  className?: string;
  iconOnly?: boolean;
  iconClassName?: string;
};

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

export function AppUpdateButton({
  appUpdate,
  className,
  iconOnly = false,
  iconClassName,
}: AppUpdateButtonProps) {
  const { t } = useLocale();
  if (!appUpdate.showUpdateButton) {
    return null;
  }

  const version = getAppUpdateDisplayVersion(appUpdate.result);
  const busy = appUpdate.installing || appUpdate.restarting;
  const installed = appUpdate.installed;
  const actionLabel = installed ? t("appUpdate.restart") : t("appUpdate.update");
  const title =
    appUpdate.status === "error" && appUpdate.message
      ? interpolate(t("appUpdate.failedRetry"), { message: appUpdate.message })
      : installed
        ? t("appUpdate.restartToComplete")
        : version
          ? interpolate(t("appUpdate.updateTo"), { version })
          : t("appUpdate.update");
  const action = () =>
    void (installed ? appUpdate.restart() : appUpdate.installAndRestart()).catch(() => undefined);

  if (iconOnly) {
    return (
      <IconButton
        type="button"
        label={title}
        tooltip={title}
        icon={
          installed ? (
            <RefreshCw className={iconClassName} />
          ) : (
            <Download className={iconClassName} />
          )
        }
        variant="primary"
        size="sm"
        isLoading={busy}
        isDisabled={busy}
        className={className}
        onClick={action}
      />
    );
  }

  return (
    <Button
      type="button"
      label={actionLabel}
      icon={
        installed ? <RefreshCw className={iconClassName} /> : <Download className={iconClassName} />
      }
      variant="primary"
      size="sm"
      tooltip={title}
      isLoading={busy}
      isDisabled={busy}
      className={className}
      onClick={action}
    />
  );
}

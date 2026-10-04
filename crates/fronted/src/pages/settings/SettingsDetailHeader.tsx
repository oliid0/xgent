import { DialogHeader, type DialogHeaderProps } from "@astryxdesign/core/Dialog";

/** Keep the title centered independently of the back and trailing controls. */
export function SettingsDetailHeader({ className, endContent, ...props }: DialogHeaderProps) {
  return (
    <DialogHeader
      {...props}
      hasDivider={false}
      className={`settings-detail-header${className ? ` ${className}` : ""}`}
      endContent={endContent ?? <span className="settings-header-spacer" aria-hidden="true" />}
    />
  );
}

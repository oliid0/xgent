import type { AppUpdateController } from "../../lib/appUpdates";
import type { AppSettings } from "../../lib/settings";
import type { SettingsSaveState } from "../../lib/settings/storage";

export type SetSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

export type SectionId =
  | "system"
  | "providers"
  | "failover"
  | "projectRoots"
  | "soul"
  | "memory"
  | "skills"
  | "mcp"
  | "hooks"
  | "cron"
  | "ssh"
  | "access"
  | "shortcuts"
  | "backup"
  | "toolPermissions"
  | "voice"
  | "usage"
  | "mobileAssistant"
  | "mobileExecution"
  | "about";

export type SettingsOpenOptions = {
  /** Opens the Soul section with a local, unsaved draft. */
  createSoul?: boolean;
};

export type SettingsPageProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
  saveState: SettingsSaveState;
  onBack: () => void;
  initialSection?: SectionId;
  soulCreateRequestId?: number;
  hiddenSections?: SectionId[];
  nativeMobile?: boolean;
  appUpdate: AppUpdateController;
};

export type SettingsSectionProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
};

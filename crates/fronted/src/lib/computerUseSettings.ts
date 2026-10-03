export type ComputerUsePermissions = { accessibility: boolean; screenCapture: boolean };

export type ComputerUseStatus = {
  enabled: boolean;
  installed: boolean;
  target: string;
  version: string | null;
  permissionsRequired: boolean;
  permissions?: ComputerUsePermissions;
};

export type ComputerUsePermission = keyof ComputerUsePermissions;

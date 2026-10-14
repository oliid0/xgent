import { invoke } from "@xgent/runtime";
import {
  checkMobileAssistantPermissions,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../mobileAssistant";
import { executeDurableMobileWrite } from "./durableMobileWrites";

export type MobileHomePowerControl = { id: string; serviceId: string; name: string };

export type MobileHomeRecord = {
  kind: "home" | "room" | "accessory" | "scene";
  id: string;
  homeId: string;
  name: string;
  roomId?: string | null;
  reachable?: boolean | null;
  powerControls?: MobileHomePowerControl[];
};
export type MobileHomeInventory = {
  source: "homekit";
  observedAtMs: number;
  records: MobileHomeRecord[];
  truncated: boolean;
};
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

function validateRequest(limit: number, homeId?: string) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    (homeId !== undefined && !isUuid(homeId))
  )
    throw new Error("Home inventory requires limit 1–200 and an optional HomeKit UUID");
}

/** Data remains on the initiating device; UUIDs identify records, never names. */
export async function listMobileHomeInventory(limit = 200, homeId?: string) {
  validateRequest(limit, homeId);
  const data = await invoke<MobileHomeInventory>("plugin:mobile-assistant|list_home_inventory", {
    request: { limit, ...(homeId === undefined ? {} : { homeId }) },
  });
  if (
    !data ||
    data.source !== "homekit" ||
    !Number.isSafeInteger(data.observedAtMs) ||
    data.observedAtMs <= 0 ||
    typeof data.truncated !== "boolean" ||
    !Array.isArray(data.records) ||
    data.records.length > limit
  )
    throw new Error("The device returned an invalid HomeKit inventory");
  const homes = new Set<string>();
  const ids = new Set<string>();
  let powerControlCount = 0;
  for (const record of data.records) {
    if (
      !record ||
      !["home", "room", "accessory", "scene"].includes(record.kind) ||
      !isUuid(record.id) ||
      !isUuid(record.homeId) ||
      typeof record.name !== "string" ||
      Array.from(record.name).length > 4096 ||
      (homeId !== undefined && record.homeId.toLowerCase() !== homeId.toLowerCase()) ||
      (record.roomId != null && (record.kind !== "accessory" || !isUuid(record.roomId))) ||
      (record.kind === "accessory"
        ? typeof record.reachable !== "boolean"
        : record.reachable != null)
    )
      throw new Error("The device returned an invalid HomeKit record");
    const key = `${record.kind}:${record.id.toLowerCase()}`;
    if (ids.has(key)) throw new Error("The device returned duplicate HomeKit records");
    ids.add(key);
    if (record.powerControls !== undefined) {
      if (
        !Array.isArray(record.powerControls) ||
        record.powerControls.length > 8 ||
        (record.kind !== "accessory" && record.powerControls.length > 0)
      )
        throw new Error("The device returned invalid Home power controls");
      for (const control of record.powerControls) {
        if (++powerControlCount > 128)
          throw new Error("Home power control inventory exceeds its bound");
        if (
          !control ||
          !isUuid(control.id) ||
          !isUuid(control.serviceId) ||
          typeof control.name !== "string" ||
          Array.from(control.name).length > 512 ||
          ids.has(`power:${control.id.toLowerCase()}`)
        )
          throw new Error("The device returned invalid or duplicate Home power controls");
        ids.add(`power:${control.id.toLowerCase()}`);
      }
    }
    if (record.kind === "home") {
      if (record.id.toLowerCase() !== record.homeId.toLowerCase())
        throw new Error("HomeKit home identity does not match");
      homes.add(record.homeId.toLowerCase());
    }
  }
  if (
    data.records.some((record) => !homes.has(record.homeId.toLowerCase())) ||
    (homeId !== undefined && !homes.has(homeId.toLowerCase()))
  )
    throw new Error("The device did not confirm the requested HomeKit home");
  return data;
}

export type MobileHomePowerRequest = {
  homeId: string;
  accessoryId: string;
  serviceId: string;
  characteristicId: string;
  power: boolean;
};

export async function setAuthorizedMobileHomePower(
  request: MobileHomePowerRequest,
  scope: string,
  signal?: AbortSignal,
  assertAccess?: () => void,
) {
  if (
    !request ||
    ![request.homeId, request.accessoryId, request.serviceId, request.characteristicId].every(
      isUuid,
    ) ||
    typeof request.power !== "boolean"
  )
    throw new Error("Home power requires observed UUIDs and a boolean state");
  const captured = {
    ...request,
    homeId: request.homeId.toLowerCase(),
    accessoryId: request.accessoryId.toLowerCase(),
    serviceId: request.serviceId.toLowerCase(),
    characteristicId: request.characteristicId.toLowerCase(),
  };
  const observed = await readAuthorizedMobileHomeInventory(
    { homeId: captured.homeId },
    signal,
    assertAccess,
  );
  const target = observed.records.find(
    (record) => record.kind === "accessory" && record.id.toLowerCase() === captured.accessoryId,
  );
  if (
    target?.reachable !== true ||
    !target.powerControls?.some(
      (control) =>
        control.id.toLowerCase() === captured.characteristicId &&
        control.serviceId.toLowerCase() === captured.serviceId,
    )
  )
    throw new Error("The requested Home power target was not observed as reachable and writable");
  if (signal?.aborted) throw new Error("Cancelled");
  assertAccess?.();
  // Once native execution starts, retain its actual receipt even if the page
  // retires. The hook discards stale presentation; native identity never changes.
  return executeDurableMobileWrite("home_power", captured, scope);
}

/** Called only by an explicit UI action or after the agent's personal policy gate. */
export async function readAuthorizedMobileHomeInventory(
  request: { limit?: number; homeId?: string } = {},
  signal?: AbortSignal,
  assertAccess?: () => void,
) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("Cancelled");
  };
  checkCancelled();
  validateRequest(request.limit ?? 200, request.homeId);
  const status = await mobileAssistantStatus();
  checkCancelled();
  const alias = status.permissionAliases.home;
  if (!status.available || status.backend !== "ios-native" || !status.homeAvailable || !alias)
    throw new Error("HomeKit requires the authorized initiating iOS device");
  let permissions = normalizeMobileAssistantPermissions(
    status,
    await checkMobileAssistantPermissions(),
  );
  checkCancelled();
  if (permissions.home === "denied")
    throw new Error("Home access was denied. Enable it in system settings before reading.");
  if (permissions.home !== "granted") {
    assertAccess?.();
    permissions = normalizeMobileAssistantPermissions(
      status,
      await requestMobileAssistantPermission(alias, signal),
    );
    checkCancelled();
  }
  if (permissions.home !== "granted") throw new Error("HomeKit permission was not granted");
  assertAccess?.();
  checkCancelled();
  const data = await listMobileHomeInventory(request.limit ?? 200, request.homeId);
  checkCancelled();
  assertAccess?.();
  return data;
}

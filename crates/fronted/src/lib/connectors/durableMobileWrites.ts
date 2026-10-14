import { invokeNative } from "@xgent/runtime";
import type { MobileActionResult } from "../mobileAssistant";
import { sha256Hex } from "../trajectory/sha256";

type WriteKind = "calendar_event" | "reminder" | "home_power";
export type MobileConnectorWriteInput = {
  operationId: string;
  deviceHostId: string;
  kind: WriteKind;
  request: Record<string, unknown>;
};
export type MobileConnectorWriteRecord = {
  input: MobileConnectorWriteInput;
  destination: { kind: WriteKind; id: string; sourceId: string; source: string };
  state: "running" | "succeeded" | "unknown";
  result: MobileActionResult | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return JSON.stringify(value) ?? "undefined";
}

async function inputFor(kind: WriteKind, request: Record<string, unknown>, scope: string) {
  if (typeof scope !== "string" || !scope.trim() || new TextEncoder().encode(scope).length > 4096)
    throw new Error("Durable connector writes require a stable bounded operation scope");
  // Capture bytes before asynchronous identity/IPC. Page edits or changes to
  // the global selected PC cannot replace an already accepted phone request.
  const captured = JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(captured)).length > 32 * 1024)
    throw new Error("Connector request exceeds 32 KiB");
  const { hostId } = await invokeNative<{ hostId: string }>("automation_device_identity");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(hostId))
    throw new Error("Missing actual native connector device identity");
  return {
    operationId: sha256Hex(`mobile-connector-v1\0${hostId}\0${scope}`),
    deviceHostId: hostId,
    kind,
    request: captured,
  } satisfies MobileConnectorWriteInput;
}

export function validateRecord(
  record: MobileConnectorWriteRecord,
  input: MobileConnectorWriteInput,
) {
  const identifier = (value: unknown) =>
    typeof value === "string" && !!value.trim() && new TextEncoder().encode(value).length <= 4096;
  if (
    !record ||
    canonical(record.input) !== canonical(input) ||
    !["running", "succeeded", "unknown"].includes(record.state) ||
    record.destination?.kind !== input.kind ||
    !identifier(record.destination.id) ||
    !identifier(record.destination.sourceId) ||
    (input.kind === "home_power" &&
      (record.destination.id !== input.request.characteristicId ||
        record.destination.sourceId !== input.request.homeId)) ||
    !Number.isSafeInteger(record.startedAt) ||
    record.startedAt < 0
  )
    throw new Error("Native connector receipt changed immutable operation/device/destination");
  return record;
}

export async function executeDurableMobileWrite(
  kind: WriteKind,
  request: Record<string, unknown>,
  scope: string,
): Promise<MobileActionResult> {
  const input = await inputFor(kind, request, scope);
  const record = validateRecord(
    await invokeNative<MobileConnectorWriteRecord>("automation_mobile_connector_execute", {
      input,
    }),
    input,
  );
  if (record.state !== "succeeded")
    throw new Error(
      `Connector operation ${input.operationId} is ${record.state}: ${record.error || "native completion has not been confirmed"}. Inspect device records; this operation will not be replayed.`,
    );
  const receipt = record.result;
  const finishedAt = record.finishedAt;
  if (
    receipt?.presented !== false ||
    typeof receipt.id !== "string" ||
    !receipt.id.trim() ||
    (input.kind === "home_power" && receipt.id !== input.request.characteristicId) ||
    typeof receipt.detail !== "string" ||
    typeof finishedAt !== "number" ||
    !Number.isSafeInteger(finishedAt) ||
    finishedAt < 0
  )
    throw new Error("Native connector did not retain an actual saved record receipt");
  return {
    ...receipt,
    operationId: input.operationId,
    deviceHostId: input.deviceHostId,
    completedAt: finishedAt,
  };
}

/** Read-only local recovery, including unknown writes, without invoking an OS write. */
export async function readDurableMobileWrite(
  kind: WriteKind,
  request: Record<string, unknown>,
  scope: string,
) {
  const input = await inputFor(kind, request, scope);
  const record = await invokeNative<MobileConnectorWriteRecord | null>(
    "automation_mobile_connector_read",
    { input },
  );
  return record ? validateRecord(record, input) : null;
}

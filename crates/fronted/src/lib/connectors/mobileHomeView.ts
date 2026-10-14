import type { ConnectorDataRow } from "./connectorDataView";
import type { MobileHomeInventory, MobileHomePowerRequest } from "./mobileHome";

/** Both settings surfaces display the same observed metadata and scope. */
export function mobileHomeRows(
  data: MobileHomeInventory,
  t: (key: string) => string,
  controls?: {
    busy: boolean;
    powerActionId?: string;
    setPower: (request: MobileHomePowerRequest) => unknown;
  },
): ConnectorDataRow[] {
  const names = new Map(
    data.records.map((record) => [
      `${record.kind}:${record.id.toLowerCase()}`,
      record.name.trim() || t(`settings.connectors.homeKind.${record.kind}`),
    ]),
  );
  return data.records.map((record) => ({
    id: `${record.kind}:${record.id}`,
    label: record.name.trim() || t(`settings.connectors.homeKind.${record.kind}`),
    icon: record.kind,
    ...(controls && record.kind === "accessory" && record.powerControls?.length
      ? {
          actions: record.powerControls.flatMap((control) =>
            [true, false].map((power) => ({
              id: `home-power:${control.id}:${power ? "on" : "off"}`,
              label: `${(record.powerControls?.length ?? 0) > 1 ? `${control.name || record.name} · ` : ""}${t(power ? "settings.connectors.homePowerOn" : "settings.connectors.homePowerOff")}`,
              enabled: !controls.busy && record.reachable === true,
              loading:
                controls.powerActionId === `home-power:${control.id}:${power ? "on" : "off"}`,
              run: () =>
                controls.setPower({
                  homeId: record.homeId,
                  accessoryId: record.id,
                  serviceId: control.serviceId,
                  characteristicId: control.id,
                  power,
                }),
            })),
          ),
        }
      : {}),
    description: [
      t(`settings.connectors.homeKind.${record.kind}`),
      ...(record.kind === "home" ? [] : [names.get(`home:${record.homeId.toLowerCase()}`)]),
      ...(record.roomId && names.has(`room:${record.roomId.toLowerCase()}`)
        ? [names.get(`room:${record.roomId.toLowerCase()}`)]
        : []),
      ...(record.kind === "accessory"
        ? [
            t(
              record.reachable
                ? "settings.connectors.homeReachable"
                : "settings.connectors.homeUnreachable",
            ),
          ]
        : []),
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

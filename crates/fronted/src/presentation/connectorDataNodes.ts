import type { ConnectorDataIcon, ConnectorDataRow } from "../lib/connectors/connectorDataView";
import type { PresentationNode } from "./types";

const icons: Record<ConnectorDataIcon, string> = {
  calendar: "calendar",
  reminders: "checklist",
  contacts: "person.crop.circle",
  home: "house",
  room: "square.grid.2x2",
  accessory: "lightbulb",
  scene: "sparkles",
};

export function connectorDataNodes(
  id: string,
  rows: ConnectorDataRow[],
  bindAction?: (
    id: string,
    label: string,
    run: () => unknown,
    enabled: boolean,
  ) => PresentationNode,
): PresentationNode {
  return {
    id,
    kind: "VStack",
    variant: "connector-data-list",
    children: rows.map((row) => ({
      id: `${id}:${row.id}`,
      kind: "VStack",
      variant: "connector-data-row",
      label: row.label,
      text: row.description,
      icon: icons[row.icon],
      ...(bindAction && row.actions?.length
        ? {
            children: row.actions.map((action) =>
              bindAction(action.id, action.label, action.run, action.enabled),
            ),
          }
        : {}),
    })),
  };
}

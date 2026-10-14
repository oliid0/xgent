import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import {
  Calendar,
  ContactRound,
  House,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Sparkles,
} from "../../components/icons";
import type { ConnectorDataRow } from "../../lib/connectors/connectorDataView";

const icons = {
  calendar: Calendar,
  reminders: ListChecks,
  contacts: ContactRound,
  home: House,
  room: LayoutGrid,
  accessory: Lightbulb,
  scene: Sparkles,
};

/** Observed rows; only explicitly bound native controls are interactive. */
export function ConnectorDataList({ rows }: { rows: ConnectorDataRow[] }) {
  return (
    <List density="balanced" className="connector-data-list">
      {rows.map((row) => {
        const Glyph = icons[row.icon];
        return (
          <ListItem
            key={row.id}
            className="connector-data-row"
            label={<Text wordBreak="break-word">{row.label}</Text>}
            startContent={
              <span
                className={`connector-data-icon connector-data-icon-${row.icon}`}
                aria-hidden="true"
              >
                <Glyph />
              </span>
            }
            description={
              row.description || row.actions?.length ? (
                <VStack gap={2}>
                  {row.description ? (
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {row.description}
                    </Text>
                  ) : null}
                  {row.actions?.length ? (
                    <HStack gap={2} wrap="wrap">
                      {row.actions.map((action) => (
                        <Button
                          key={action.id}
                          className="connector-data-action"
                          label={action.label}
                          size="lg"
                          aria-label={`${row.label} · ${action.label}`}
                          isDisabled={!action.enabled}
                          isLoading={action.loading}
                          onClick={() => void action.run()}
                        />
                      ))}
                    </HStack>
                  ) : null}
                </VStack>
              ) : undefined
            }
          />
        );
      })}
    </List>
  );
}

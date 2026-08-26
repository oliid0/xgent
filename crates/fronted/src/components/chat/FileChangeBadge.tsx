import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { cn } from "../../lib/shared/utils";
import { OdometerNumber } from "./OdometerNumber";

// Green +N / red -N line-change badge for the collapsed Write/Edit tool bar.
export function FileChangeBadge({
  added,
  removed,
  className,
}: {
  added?: number;
  removed?: number;
  className?: string;
}) {
  if (added === undefined && removed === undefined) return null;
  return (
    <HStack
      as="span"
      gap={1.5}
      vAlign="center"
      className={cn(
        "shrink-0 font-mono text-[calc(var(--text-supporting-size)*var(--zone-font-scale,1))] tabular-nums",
        className,
      )}
    >
      {added !== undefined ? (
        <Text type="code" color="inherit" className="text-success">
          +<OdometerNumber value={added} />
        </Text>
      ) : null}
      {removed !== undefined ? (
        <Text type="code" color="inherit" className="text-error">
          -<OdometerNumber value={removed} />
        </Text>
      ) : null}
    </HStack>
  );
}

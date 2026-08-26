import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { cn } from "../../lib/shared/utils";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

// Rolling-digit odometer. Each digit is a 1em-high viewport over a vertical
// 0-9 strip translated to the current digit; CSS transitions animate value
// changes (both directions) but not the initial paint, so freshly mounted
// digits — including new most-significant columns — appear in place without
// rolling. Columns are keyed by place value from the least-significant end so
// 99 -> 100 keeps the ones/tens columns' identity.
export function OdometerNumber({ value, className }: { value: number; className?: string }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const text = String(safe);
  return (
    <HStack as="span" className={cn("inline-flex tabular-nums leading-none", className)}>
      <Text type="inherit" className="sr-only">
        {text}
      </Text>
      <HStack as="span" aria-hidden="true" className="inline-flex">
        {Array.from(text).map((char, index) => {
          const digit = char.charCodeAt(0) - 48;
          const place = text.length - 1 - index;
          return (
            <HStack
              as="span"
              key={`p${place}`}
              className="inline-block h-[1em] w-[1ch] overflow-hidden"
            >
              <VStack
                as="span"
                className="transition-transform duration-[var(--duration-medium)] ease-[var(--ease-standard)] will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateY(-${digit}em)` }}
              >
                {DIGITS.map((strip) => (
                  <HStack
                    as="span"
                    key={strip}
                    hAlign="center"
                    vAlign="center"
                    className="h-[1em] w-[1ch]"
                  >
                    {strip}
                  </HStack>
                ))}
              </VStack>
            </HStack>
          );
        })}
      </HStack>
    </HStack>
  );
}

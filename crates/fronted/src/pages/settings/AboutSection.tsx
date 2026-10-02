import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";

export function AboutSection({ currentVersion }: { currentVersion: string }) {
  return (
    <VStack width="100%" gap={1}>
      <Heading level={3}>XGent</Heading>
      <Text color="secondary">v{currentVersion}</Text>
    </VStack>
  );
}

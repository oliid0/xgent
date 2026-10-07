import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { FileText, GitBranch, MessageSquare, Terminal } from "../../../components/icons";
import { useLocale } from "../../../i18n";

export type BrowserTools = {
  onNewTerminal?: () => void;
  onOpenReview?: () => void;
  onOpenFiles?: () => void;
  onNewSideChat?: () => void;
  toolsDisabled?: boolean;
};

/** A new tab exposes only actions supplied by the current conversation mode. */
export function BrowserStartPage(props: BrowserTools) {
  const { t } = useLocale();
  const tools = [
    { run: props.onOpenReview, label: t("sidebar.gitReview"), icon: GitBranch },
    { run: props.onNewTerminal, label: t("sidebar.terminal"), icon: Terminal },
    { run: props.onOpenFiles, label: t("sidebar.myFiles"), icon: FileText },
    { run: props.onNewSideChat, label: t("chat.split.toolbar"), icon: MessageSquare },
  ].filter((tool) => tool.run);
  return (
    <VStack
      className="browser-start-page"
      width="100%"
      maxWidth={720}
      minHeight={0}
      padding={4}
      gap={4}
      isScrollable
    >
      {tools.length ? (
        <>
          <Heading level={3}>{t("browser.tools")}</Heading>
          <Grid columns={{ minWidth: 260, max: 2, repeat: "fit" }} gap={3} width="100%">
            {tools.map((tool) => (
              <Button
                key={tool.label}
                className="browser-start-tool"
                label={tool.label}
                icon={<Icon icon={tool.icon} size="sm" />}
                variant="secondary"
                size="lg"
                width="100%"
                onClick={tool.run}
                isDisabled={props.toolsDisabled}
              />
            ))}
          </Grid>
        </>
      ) : null}
      <Text type="supporting" color="secondary">
        {t("browser.startBrowsingDescription")}
      </Text>
    </VStack>
  );
}

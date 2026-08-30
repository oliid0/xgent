import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { AdaptiveDialog } from "../../../components/astryx/AdaptiveDialog";
import { FolderTree } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { AppSettings, WorkspaceProject } from "../../../lib/settings";
import { ProjectRootsSection } from "../../settings/ProjectRootsSection";
import type { SettingsSectionProps } from "../../settings/types";

export function WorkspaceProjectSettingsDialog(props: {
  project: WorkspaceProject;
  settings: AppSettings;
  setSettings: SettingsSectionProps["setSettings"];
  onClose: () => void;
}) {
  const { project, settings, setSettings, onClose } = props;
  const { t } = useLocale();

  return (
    <AdaptiveDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      title={t("chat.workspaceSettings")}
      subtitle={project.path}
      width="min(52rem, calc(100dvw - var(--spacing-8)))"
      maxHeight="min(46rem, calc(100dvh - var(--spacing-8)))"
      touchPresentation="fullscreen"
    >
      <VStack gap={4} width="100%">
        <HStack gap={3} vAlign="center" width="100%">
          <Icon icon={FolderTree} size="md" color="accent" />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Text type="label" weight="semibold" maxLines={1}>
                {project.name}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {project.path}
              </Text>
            </VStack>
          </StackItem>
        </HStack>
        <ProjectRootsSection
          settings={settings}
          setSettings={setSettings}
          selectedProjectId={project.id}
          showProjectSelector={false}
        />
      </VStack>
    </AdaptiveDialog>
  );
}

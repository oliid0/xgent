import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useEffect, useState } from "react";
import { FolderOpen, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  cancelGitClone,
  dismissGitClone,
  listGitCloneTasks,
} from "../../../lib/git/tauriGitClient";
import type { GitCloneTask } from "../../../lib/git/types";

export function WorkspaceCloneTaskOverlay(props: { onOpenWorkspace: (path: string) => void }) {
  const { onOpenWorkspace } = props;
  const { t } = useLocale();
  const [tasks, setTasks] = useState<GitCloneTask[]>([]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await listGitCloneTasks();
        if (!disposed) setTasks(next);
      } catch {
        // The desktop bridge may be unavailable while the WebView is reloading.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 650);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  if (tasks.length === 0) return null;

  return (
    <VStack
      gap={2}
      data-edge-swipe-ignore
      className="fixed bottom-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))] left-[var(--spacing-3)] right-[var(--spacing-3)] z-[var(--xagent-z-task-overlay)] md:left-auto md:right-[var(--spacing-4)] md:w-[var(--xagent-task-overlay-width)]"
    >
      {tasks.map((task) => {
        const running = task.status === "running" || task.status === "cancelling";
        const completed = task.status === "completed";
        return (
          <Card key={task.id} width="100%" padding={3} elevation="high">
            <VStack gap={3}>
              <HStack gap={3} vAlign="start">
                {running ? <Spinner aria-label={task.repositoryName} size="sm" /> : <FolderOpen />}
                <StackItem size="fill">
                  <VStack gap={1}>
                    <Heading level={4} maxLines={1}>
                      {task.repositoryName}
                    </Heading>
                    <Text type="supporting" color="secondary" maxLines={2}>
                      {task.error || task.detail}
                    </Text>
                    <StatusDot
                      label={task.status}
                      variant={task.error ? "error" : completed ? "success" : "accent"}
                      isPulsing={running}
                    />
                  </VStack>
                </StackItem>
                {!running ? (
                  <IconButton
                    type="button"
                    label={t("chat.clone.dismiss")}
                    tooltip={t("chat.clone.dismiss")}
                    icon={<X />}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void dismissGitClone(task.id).then(setTasks);
                    }}
                  />
                ) : null}
              </HStack>
              {running ? (
                <VStack gap={2}>
                  <ProgressBar
                    label={task.repositoryName}
                    value={task.progress ?? 8}
                    max={100}
                    isLabelHidden
                    variant="accent"
                  />
                  <Button
                    type="button"
                    label={
                      task.status === "cancelling"
                        ? t("chat.clone.cancelling")
                        : t("chat.clone.cancel")
                    }
                    variant="destructive"
                    size="sm"
                    isLoading={task.status === "cancelling"}
                    isDisabled={task.status === "cancelling"}
                    onClick={() =>
                      void cancelGitClone(task.id).then((next) =>
                        setTasks((prev) => prev.map((item) => (item.id === next.id ? next : item))),
                      )
                    }
                  />
                </VStack>
              ) : completed ? (
                <Button
                  type="button"
                  label={t("chat.clone.open")}
                  icon={<FolderOpen />}
                  variant="primary"
                  width="100%"
                  onClick={() => onOpenWorkspace(task.targetPath)}
                />
              ) : null}
            </VStack>
          </Card>
        );
      })}
    </VStack>
  );
}

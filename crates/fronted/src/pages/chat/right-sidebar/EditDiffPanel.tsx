import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useMemo, useSyncExternalStore } from "react";
import "@git-diff-view/react/styles/diff-view.css";

import { FileText } from "../../../components/icons";
import type { ChangedFileEntry } from "../../../lib/chat/messages/changedFiles";

const darkModeListeners = new Set<() => void>();
let darkModeObserver: MutationObserver | null = null;

function subscribeDarkMode(listener: () => void) {
  darkModeListeners.add(listener);
  darkModeObserver ??= new MutationObserver(() => {
    for (const notify of darkModeListeners) notify();
  });
  darkModeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => {
    darkModeListeners.delete(listener);
    if (darkModeListeners.size === 0) {
      darkModeObserver?.disconnect();
      darkModeObserver = null;
    }
  };
}

const isDarkMode = () => document.documentElement.classList.contains("dark");

function languageForPath(path: string) {
  return path.split(".").pop()?.toLowerCase() || "txt";
}

export function EditDiffPanel(props: { file: ChangedFileEntry | null }) {
  const isDark = useSyncExternalStore(subscribeDarkMode, isDarkMode, isDarkMode);
  const diffFile = useMemo(() => {
    const file = props.file;
    if (!file?.beforeTextAvailable || !file.afterTextAvailable) return null;
    const language = languageForPath(file.path);
    const diff = generateDiffFile(
      file.path,
      file.beforeText ?? "",
      file.path,
      file.afterText ?? "",
      language,
      language,
    );
    diff.init();
    diff.buildSplitDiffLines();
    return diff;
  }, [props.file]);

  if (!props.file) {
    return (
      <EmptyState
        isCompact
        icon={<Icon icon={FileText} size="lg" color="secondary" />}
        title="No edit selected"
      />
    );
  }

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <HStack
        gap={2}
        vAlign="center"
        padding={3}
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <Icon icon={FileText} size="sm" color="accent" />
        <StackItem size="fill">
          <Heading level={3} maxLines={1}>
            {props.file.path}
          </Heading>
        </StackItem>
        <Text type="supporting" color="secondary" hasTabularNumbers>
          +{props.file.added} / -{props.file.removed}
        </Text>
      </HStack>
      <StackItem size="fill" style={{ minHeight: 0, overflow: "auto" }}>
        {diffFile ? (
          <DiffView
            diffFile={diffFile}
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme={isDark ? "dark" : "light"}
            diffViewHighlight
            diffViewAddWidget={false}
            diffViewWrap
            diffViewFontSize={12}
          />
        ) : (
          <EmptyState
            isCompact
            icon={<Icon icon={FileText} size="lg" color="secondary" />}
            title="Diff preview unavailable"
            description="This edit was recorded without a complete before/after snapshot."
          />
        )}
      </StackItem>
    </VStack>
  );
}

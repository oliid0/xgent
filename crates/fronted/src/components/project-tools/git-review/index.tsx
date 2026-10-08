// GitReview panel assembly: reads the workspace-tools context, owns the
// layout/presentation state shared across views and composes the toolbar,
// status view and history view around the data layer.
//
// Shared by every frontend runtime; only relative or @xgent/runtime imports
// are allowed here.

import { VStack } from "@astryxdesign/core/Layout";
import { memo, useCallback, useRef, useState } from "react";
import { useLocale } from "../../../i18n";
import { GitReviewHistoryView } from "./HistoryView";
import type { ChangeListSection, DiffViewKind, GitReviewStackedPane } from "./model";
import { GitReviewStatusView } from "./StatusView";
import { GitOperationNoticeToast, GitRemoteSetupModal, GitReviewToolbar } from "./Toolbar";
import { useGitReviewData } from "./useGitReviewData";

export type { GitCommitContextPayload, GitFileContextPayload } from "./model";

type GitReviewPanelProps = {
  // Visibility contract from the workspace feature panel: while inactive the
  // panel issues no requests (invalidations are buffered and flushed on
  // activation by the data layer).
  active?: boolean;
};

export const GitReviewPanel = memo(function GitReviewPanel(props: GitReviewPanelProps) {
  const { active = true } = props;
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeDiffView, setActiveDiffView] = useState<DiffViewKind>("workingTree");
  const [commitMessage, setCommitMessage] = useState("");
  const [collapsedChangeSections, setCollapsedChangeSections] = useState<
    Record<ChangeListSection, boolean>
  >({
    staged: false,
    changes: false,
  });

  const data = useGitReviewData({ active });
  const { busy, canWrite, cwd, disabledMessage, reviewMode, state } = data;

  // Container queries choose horizontal or vertical panes without a delayed
  // resize callback. A hidden diff gives all available space to the list.
  const useSplitReviewLayout = data.diffVisible;

  const writeDisabled = !canWrite || Boolean(disabledMessage) || state.status !== "ready";
  const visibleError =
    reviewMode === "history"
      ? data.historyCommits.length === 0
        ? data.historyError
        : ""
      : data.error;

  const handleToggleSection = useCallback((section: ChangeListSection) => {
    setCollapsedChangeSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }, []);

  const revealDetail = useCallback(
    (pane: GitReviewStackedPane) => {
      if (pane === "detail") data.setDiffVisible(true);
    },
    [data.setDiffVisible],
  );

  return (
    <VStack
      ref={panelRef}
      height="100%"
      minHeight={0}
      style={{
        position: "relative",
        containerType: "inline-size",
        containerName: "xgent-git-review",
      }}
    >
      <GitRemoteSetupModal
        open={data.remoteSetupOpen}
        action={data.remoteSetupAction}
        workdir={cwd}
        branch={state.head || t("projectTools.gitReview.unresolved")}
        remoteUrl={data.remoteSetupUrl}
        loading={busy === "set_remote"}
        error={data.remoteSetupError}
        onRemoteUrlChange={data.setRemoteSetupUrl}
        onClose={data.closeRemoteSetup}
        onSubmit={data.saveRemoteAndContinue}
      />
      <GitOperationNoticeToast
        notice={data.operationNotice}
        onDismiss={data.dismissOperationNotice}
      />
      <GitReviewToolbar data={data} visibleError={visibleError} writeDisabled={writeDisabled} />
      {reviewMode === "changes" ? (
        <GitReviewStatusView
          activeDiffView={activeDiffView}
          collapsedSections={collapsedChangeSections}
          commitMessage={commitMessage}
          data={data}
          onActiveDiffViewChange={setActiveDiffView}
          onCommitMessageChange={setCommitMessage}
          onStackedPaneChange={revealDetail}
          onToggleSection={handleToggleSection}
          panelRef={panelRef}
          stackedDir="forward"
          stackedPane="list"
          useSplitReviewLayout={useSplitReviewLayout}
          writeDisabled={writeDisabled}
        />
      ) : (
        <GitReviewHistoryView
          data={data}
          onStackedPaneChange={revealDetail}
          panelRef={panelRef}
          stackedDir="forward"
          stackedPane="list"
          useSplitReviewLayout={useSplitReviewLayout}
          writeDisabled={writeDisabled}
        />
      )}
    </VStack>
  );
});

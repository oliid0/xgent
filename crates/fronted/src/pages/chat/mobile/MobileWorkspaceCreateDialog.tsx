import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { type SearchableItem, type SearchSource, Typeahead } from "@astryxdesign/core/Typeahead";
import { invoke } from "@xagent/runtime";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AdaptiveDialog } from "../../../components/astryx/AdaptiveDialog";
import { useLocale } from "../../../i18n";
import { listGitRemoteBranches, startGitClone } from "../../../lib/git/tauriGitClient";

type MobileWorkspaceCreateDialogProps = {
  open: boolean;
  parent: string;
  onCreated: (path: string, kind: "managed" | "folder") => void;
  onCloneStarted?: () => void;
  cloneAvailable?: boolean;
  onClose: () => void;
};

export function MobileWorkspaceCreateDialog(props: MobileWorkspaceCreateDialogProps) {
  const { open, parent, onCreated, onCloneStarted, cloneAvailable = false, onClose } = props;
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"new" | "clone">("new");
  const [destination, setDestination] = useState(parent);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const branchItems = useMemo<SearchableItem[]>(
    () => remoteBranches.map((item) => ({ id: item, label: item })),
    [remoteBranches],
  );
  const branchSearchSource = useMemo<SearchSource<SearchableItem>>(
    () => ({
      search: (query) => {
        const normalized = query.trim().toLocaleLowerCase();
        return normalized
          ? branchItems.filter((item) => item.label.toLocaleLowerCase().includes(normalized))
          : branchItems;
      },
      bootstrap: () => branchItems,
    }),
    [branchItems],
  );
  const selectedBranch = branchItems.find((item) => item.label === branch) ?? null;

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
    setMode("new");
    setDestination(parent);
    setRemoteUrl("");
    setBranch("");
    setRemoteBranches([]);
  }, [open, parent]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || !destination || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "clone") {
        if (!remoteUrl.trim()) return;
        await startGitClone({
          parent: destination,
          name: workspaceName,
          remoteUrl: remoteUrl.trim(),
          branch: branch.trim() || undefined,
        });
        onCloneStarted?.();
      } else {
        const response = await invoke<{ path: string }>("system_create_project_folder", {
          parent: destination,
          name: workspaceName,
        });
        onCreated(response.path, "managed");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const pickDestination = async () => {
    if (busy) return;
    try {
      const selected = await invoke<string | null>("system_pick_folder", {
        initial_workdir: destination || null,
      });
      if (selected?.trim()) setDestination(selected.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const loadBranches = async () => {
    if (!remoteUrl.trim() || loadingBranches) return;
    setLoadingBranches(true);
    setError("");
    try {
      const result = await listGitRemoteBranches(remoteUrl.trim());
      setRemoteBranches(result.branches);
      if (!branch.trim()) setBranch(result.defaultBranch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingBranches(false);
    }
  };

  const pickExternal = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const selected = await invoke<string | null>("system_pick_folder", {
        initial_workdir: null,
      });
      if (selected?.trim()) onCreated(selected.trim(), "folder");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdaptiveDialog
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      title={mode === "clone" ? t("chat.clone.title") : t("chat.mobileWorkspace.new")}
      subtitle={t("chat.mobileWorkspace.hint")}
      purpose="form"
      width="var(--xagent-dialog-width-md)"
      maxHeight="var(--xagent-dialog-height-lg)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
    >
      <form onSubmit={(event) => void submit(event)}>
        <VStack gap={4}>
          {cloneAvailable ? (
            <SegmentedControl
              value={mode}
              onChange={(value) => {
                setMode(value as "new" | "clone");
                setError("");
              }}
              label={t("chat.mobileWorkspace.new")}
              layout="fill"
            >
              <SegmentedControlItem value="new" label={t("chat.clone.newTab")} />
              <SegmentedControlItem value="clone" label={t("chat.clone.cloneTab")} />
            </SegmentedControl>
          ) : null}
          {mode === "clone" ? (
            <>
              <TextInput
                label={t("chat.clone.remoteUrl")}
                hasAutoFocus
                value={remoteUrl}
                onChange={(value) => {
                  setRemoteUrl(value);
                  if (!name.trim()) {
                    const inferred = value
                      .trim()
                      .replace(/[\\/]+$/, "")
                      .split(/[\\/]/)
                      .pop()
                      ?.replace(/\.git$/i, "");
                    if (inferred) setName(inferred);
                  }
                }}
                placeholder="https://github.com/owner/repository.git"
                size="lg"
                width="100%"
              />
              <HStack gap={2} vAlign="end">
                <Typeahead
                  label={t("chat.clone.branch")}
                  searchSource={branchSearchSource}
                  value={selectedBranch}
                  onChange={(item) => setBranch(item?.label ?? "")}
                  onChangeQuery={setBranch}
                  placeholder={t("chat.clone.defaultBranch")}
                  hasEntriesOnFocus
                  hasClear
                  size="lg"
                  width="100%"
                  debounceMs={0}
                />
                <Button
                  label={t("chat.clone.loadBranches")}
                  size="lg"
                  isLoading={loadingBranches}
                  isDisabled={!remoteUrl.trim() || loadingBranches}
                  onClick={() => void loadBranches()}
                />
              </HStack>
            </>
          ) : null}
          <FormLayout>
            <TextInput
              label={t("chat.mobileWorkspace.name")}
              hasAutoFocus={mode === "new"}
              value={name}
              onChange={setName}
              placeholder={t("chat.mobileWorkspace.placeholder")}
              size="lg"
              width="100%"
            />
          </FormLayout>
          <Text type="code" color="secondary" maxLines={2} wordBreak="break-all">
            {destination}
          </Text>
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
          <Button
            type="submit"
            label={
              busy
                ? mode === "clone"
                  ? t("chat.clone.starting")
                  : t("chat.mobileWorkspace.creating")
                : mode === "clone"
                  ? t("chat.clone.start")
                  : t("chat.mobileWorkspace.create")
            }
            variant="primary"
            size="lg"
            width="100%"
            isLoading={busy}
            isDisabled={
              !name.trim() || !destination || busy || (mode === "clone" && !remoteUrl.trim())
            }
          />
          {cloneAvailable ? (
            <Button
              label={t("chat.clone.chooseDestination")}
              size="lg"
              width="100%"
              isDisabled={busy}
              onClick={() => void pickDestination()}
            />
          ) : null}
          {mode === "new" ? (
            <>
              <Divider label={t("chat.mobileWorkspace.or")} />
              <Button
                label={t("chat.mobileWorkspace.chooseFolder")}
                size="lg"
                width="100%"
                isDisabled={busy}
                onClick={() => void pickExternal()}
              />
              <Text type="supporting" color="secondary">
                {t("chat.mobileWorkspace.chooseFolderHint")}
              </Text>
            </>
          ) : null}
        </VStack>
      </form>
    </AdaptiveDialog>
  );
}

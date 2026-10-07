import { useCallback, useEffect, useRef } from "react";
import type { MentionComposerSkill } from "../../../components/chat/MentionComposer";
import {
  type AppSettings,
  isAgentExecutionMode,
  resolveWorkspaceResources,
  updateSkills,
  updateWorkspaceResourceSettings,
} from "../../../lib/settings";
import { isUserSelectableSkill, mergeAlwaysEnabledSkillNames } from "../../../lib/skills";

export function useComposerSkillSelection(props: {
  availableSkills: MentionComposerSkill[];
  conversationId: string;
  workdir: string;
  enabled: boolean;
  setSettings: (updater: (previous: AppSettings) => AppSettings) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    (skill: MentionComposerSkill) => {
      const current = latest.current;
      if (
        !mounted.current ||
        !current.enabled ||
        current.conversationId !== props.conversationId ||
        current.workdir !== props.workdir ||
        !isUserSelectableSkill(skill) ||
        !current.availableSkills.some(
          (candidate) =>
            candidate.name === skill.name &&
            candidate.skillFile === skill.skillFile &&
            candidate.baseDir === skill.baseDir,
        )
      )
        return false;
      current.setSettings((previous) => {
        if (
          !mounted.current ||
          !latest.current.enabled ||
          latest.current.conversationId !== props.conversationId ||
          latest.current.workdir !== props.workdir ||
          !isAgentExecutionMode(previous.system.executionMode)
        )
          return previous;
        const resources = resolveWorkspaceResources(previous, props.workdir);
        if (!resources.skillsEnabled || resources.skillNames.includes(skill.name)) return previous;
        const selected = mergeAlwaysEnabledSkillNames([...resources.skillNames, skill.name]);
        return resources.mode === "custom"
          ? updateWorkspaceResourceSettings(previous, props.workdir, {
              mode: "custom",
              skillNames: selected,
              mcpServerIds: resources.mcpServerIds,
            })
          : updateSkills(previous, { selected });
      });
      return true;
    },
    [props.conversationId, props.workdir],
  );
}

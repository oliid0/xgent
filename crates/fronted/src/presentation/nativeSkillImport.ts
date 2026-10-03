import type { ExternalToolScan } from "../lib/skills";
import type { presentationControls } from "./controls";
import { decodeNativeSkillBundle } from "./nativeSkillBundle";
import type { PresentationNode } from "./types";

export function nativeSkillImport(options: {
  c: ReturnType<typeof presentationControls>;
  t: (key: string) => string;
  scans: ExternalToolScan[];
  tool: string;
  chooseTool: (tool: string) => void;
  query: string;
  selected: ReadonlySet<string>;
  installedNames: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  progress: { done: number; total: number } | null;
  errors: { baseDir: string; name: string; message: string }[];
  importedCount: number | null;
  localImporting: boolean;
  toast: string | null;
  dismissToast: () => void;
  toggle: (path: string) => void;
  batchToggle: (paths: string[], selected: boolean) => void;
  rescan: () => void;
  import: () => void;
  importLocal: (files: File[]) => void;
}): PresentationNode[] {
  const { c, t } = options;
  const labels: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
    codebuddy: "CodeBuddy",
  };
  const scan = options.scans.find((item) => item.tool === options.tool);
  const needle = options.query.trim().toLowerCase();
  const visible = (scan?.skills ?? []).filter(
    (skill) => !needle || `${skill.name}\n${skill.description}`.toLowerCase().includes(needle),
  );
  const selectable = visible
    .filter((skill) => !options.installedNames.has(skill.name))
    .map((skill) => skill.baseDir);
  const checked = selectable.filter((path) => options.selected.has(path)).length;
  const busy = options.progress !== null || options.localImporting;
  const count = options.scans
    .flatMap((scan) => scan.skills)
    .filter(
      (skill) => !options.installedNames.has(skill.name) && options.selected.has(skill.baseDir),
    ).length;
  const filePicker = c.input(
    "skill-bundle-picker",
    t("settings.skillsLocalImport"),
    "",
    (payload) => options.importLocal(decodeNativeSkillBundle(payload)),
    false,
    !busy,
  );
  return [
    ...(options.error
      ? [
          {
            id: "skill-import-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: options.error,
          },
        ]
      : []),
    ...(options.toast
      ? [
          {
            id: "skill-import-toast",
            kind: "Banner" as const,
            status: "paused" as const,
            label: options.toast,
            children: [
              c.action("skill-import-dismiss-toast", t("settings.close"), options.dismissToast),
            ],
          },
        ]
      : []),
    ...(options.importedCount !== null
      ? [
          {
            id: "skill-import-done",
            kind: "Banner" as const,
            status: "completed" as const,
            label: `${t("settings.skillsImportDone")} (${options.importedCount})`,
          },
        ]
      : []),
    ...(options.loading
      ? [
          {
            id: "skill-import-scanning",
            kind: "Progress" as const,
            label: t("settings.skillsScanning"),
          },
        ]
      : []),
    ...(options.scans.length
      ? [
          c.select(
            "skill-import-source",
            t("settings.skillsHubImportTab"),
            options.tool,
            options.scans.map((item) => ({
              value: item.tool,
              label: `${labels[item.tool] || item.tool} (${item.skills.length})`,
            })),
            options.chooseTool,
            !busy,
          ),
        ]
      : []),
    {
      ...filePicker,
      kind: "FilePicker",
      variant: "skill-bundle",
      options: [
        { value: "folder", label: t("settings.skillsLocalImport") },
        { value: "files", label: t("settings.skillsLocalImportFiles") },
      ],
    },
    {
      id: "skill-import-actions",
      kind: "VStack",
      variant: "skill-hub-controls",
      children: [
        c.action(
          "skill-import-rescan",
          t("settings.skillsScan"),
          options.rescan,
          !options.loading && !busy,
        ),
        {
          ...c.action(
            "skill-import-selected",
            `${t("settings.skillsImportButton")} (${count})`,
            options.import,
            count > 0 && !busy && !options.loading,
          ),
          prominent: true,
        },
      ],
    },
    ...(options.progress
      ? [
          {
            id: "skill-import-progress",
            kind: "Progress" as const,
            label: t("settings.skillsImportButton"),
            current: options.progress.done,
            total: options.progress.total,
          },
        ]
      : []),
    ...options.errors.map(
      (error, index): PresentationNode => ({
        id: `skill-import-failure:${index}`,
        kind: "Banner",
        status: "error",
        label: error.name,
        text: error.message,
      }),
    ),
    ...(scan
      ? [
          { id: "skill-import-path", kind: "Text" as const, text: scan.rootDir, secondary: true },
          ...(scan.errors.length
            ? [
                {
                  id: "skill-import-unparsable",
                  kind: "Banner" as const,
                  status: "paused" as const,
                  label: t("settings.skillsImportScanFailed"),
                  text: scan.errors.join("\n"),
                },
              ]
            : []),
          c.toggle(
            "skill-import-select-all",
            `${t("settings.skillsHubSelectedShort")} ${checked} / ${selectable.length}`,
            selectable.length > 0 && checked === selectable.length,
            (selected) => options.batchToggle(selectable, selected),
            selectable.length > 0 && !busy,
          ),
          ...visible.map(
            (skill): PresentationNode => ({
              id: `skill-import:${skill.baseDir}`,
              kind: "VStack",
              variant: "skill-import-row",
              label: skill.name,
              children: [
                {
                  id: `skill-import:${skill.baseDir}:description`,
                  kind: "Text",
                  text: skill.description,
                  secondary: true,
                },
                {
                  id: `skill-import:${skill.baseDir}:path`,
                  kind: "Text",
                  text: skill.skillFile,
                  secondary: true,
                },
                ...(options.installedNames.has(skill.name)
                  ? [
                      {
                        id: `skill-import:${skill.baseDir}:installed`,
                        kind: "Badge" as const,
                        label: t("settings.skillsImportAlreadyInstalled"),
                      },
                    ]
                  : [
                      c.toggle(
                        `skill-import:${skill.baseDir}:selected`,
                        skill.name,
                        options.selected.has(skill.baseDir),
                        () => options.toggle(skill.baseDir),
                        !busy,
                      ),
                    ]),
              ],
            }),
          ),
          ...(visible.length === 0
            ? [
                {
                  id: "skill-import-empty",
                  kind: "EmptyState" as const,
                  label: t(
                    scan.exists ? "settings.skillsNotFound" : "settings.skillsImportNotDetected",
                  ),
                  text: scan.rootDir,
                },
              ]
            : []),
        ]
      : []),
  ];
}

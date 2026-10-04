import { invoke } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { updateCustomSettings } from "../lib/settings";
import {
  buildFontFamilySelectOptions,
  FONT_FAMILY_CUSTOM_SELECT_VALUE,
  FONT_FAMILY_DEFAULT_SELECT_VALUE,
  type FontFamilySettings,
  fromFontFamilySelectValue,
  normalizeFontFamily,
  toFontFamilySelectValue,
} from "../lib/system/fontFamily";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

type FontKey = keyof FontFamilySettings;

export function useNativeFontSettings(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  t: (key: string) => string,
) {
  const [families, setFamilies] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<FontKey, string>>>({});
  const [custom, setCustom] = useState<Partial<Record<FontKey, boolean>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scope] = useState(() => ({ active: enabled, revision: 0 }));
  scope.active = enabled;

  async function refresh() {
    if (!scope.active) return;
    const revision = ++scope.revision;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<string[]>("apple_ui_font_families");
      if (scope.active && revision === scope.revision) setFamilies(result);
    } catch (cause) {
      if (scope.active && revision === scope.revision) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    } finally {
      if (scope.active && revision === scope.revision) setLoading(false);
    }
  }

  useEffect(() => {
    scope.active = enabled;
    if (enabled) void refresh().catch(() => undefined);
    else {
      setDrafts({});
      setCustom({});
      setLoading(false);
    }
    return () => {
      scope.active = false;
      scope.revision++;
    };
  }, [enabled]);

  const c = presentationControls();
  if (!enabled) return { nodes: [], handlers: c.handlers };
  const options = buildFontFamilySelectOptions(families);
  const fields: Array<{ key: FontKey; label: string }> = [
    { key: "interfaceFontFamily", label: t("settings.interfaceFontFamily") },
    { key: "chatFontFamily", label: t("settings.chatFontFamily") },
    { key: "codeFontFamily", label: t("settings.codeFontFamily") },
  ];
  const patch = (key: FontKey, value: string) =>
    setSettings((previous) => updateCustomSettings(previous, { [key]: value }));
  const nodes: PresentationNode[] = [
    c.group(
      "desktop-font-family",
      t("settings.fontFamily"),
      fields.flatMap(({ key, label }) => {
        const value = settings.customSettings[key];
        const selected = toFontFamilySelectValue(value, options, custom[key]);
        return [
          {
            ...c.select(
              `font-family:${key}`,
              label,
              selected,
              [
                { value: FONT_FAMILY_DEFAULT_SELECT_VALUE, label: t("settings.fontFamilyDefault") },
                { value: FONT_FAMILY_CUSTOM_SELECT_VALUE, label: t("settings.fontFamilyCustom") },
                ...options,
              ],
              (next) => {
                setCustom((previous) => ({
                  ...previous,
                  [key]: next === FONT_FAMILY_CUSTOM_SELECT_VALUE,
                }));
                if (next === FONT_FAMILY_CUSTOM_SELECT_VALUE) {
                  setDrafts((previous) => ({ ...previous, [key]: previous[key] ?? value }));
                } else {
                  patch(key, fromFontFamilySelectValue(next));
                  setDrafts((previous) => ({ ...previous, [key]: undefined }));
                }
              },
            ),
            variant: "searchable-selector",
            children: [
              { id: `font-family:${key}:search`, kind: "Text", label: t("search.title") },
              {
                id: `font-family:${key}:empty`,
                kind: "EmptyState",
                label: t("projectTools.fileTree.noMatches"),
              },
              {
                id: `font-family:${key}:search-clear-label`,
                kind: "Text",
                label: t("chat.history.searchClear"),
              },
              { id: `font-family:${key}:close`, kind: "Text", label: t("settings.cancel") },
            ],
          },
          ...(selected === FONT_FAMILY_CUSTOM_SELECT_VALUE
            ? [
                {
                  ...c.committedInput(
                    `font-family:${key}:custom`,
                    t("settings.fontFamilyCustom"),
                    drafts[key] ?? value,
                    (draft) => setDrafts((previous) => ({ ...previous, [key]: draft })),
                    (draft) => {
                      patch(key, draft);
                      setDrafts((previous) => ({ ...previous, [key]: draft }));
                    },
                    false,
                    true,
                    (draft) => {
                      const normalized = normalizeFontFamily(draft);
                      if (draft.trim() && !normalized)
                        throw new Error(t("settings.fontFamilyInvalid"));
                      return normalized;
                    },
                  ),
                  text: t("settings.fontFamilyPlaceholder"),
                },
              ]
            : []),
        ];
      }),
    ),
  ];
  if (loading)
    nodes.push({ id: "font-families-loading", kind: "Progress", label: t("settings.loading") });
  if (error)
    nodes.push({ id: "font-families-error", kind: "Banner", label: error, status: "error" });
  nodes.push(c.action("font-families-refresh", t("settings.mobileRefresh"), refresh, !loading));
  return { nodes, handlers: c.handlers };
}

import type { ModelOptionGroup } from "./page/chatPageHelpers";

/** Filter the view without changing option values or the configured provider order. */
export function filterModelPickerGroups(
  groups: readonly ModelOptionGroup[],
  query: string,
  providerId: string,
  sortByName: boolean,
  locale?: string,
) {
  const search = query.trim().toLocaleLowerCase(locale);
  const activeProvider = groups.some((group) => group.id === providerId) ? providerId : "";
  const result = groups.flatMap((group) => {
    if (activeProvider && group.id !== activeProvider) return [];
    const opts = search
      ? group.opts.filter((option) =>
          [option.model, option.label, option.providerName].some((value) =>
            value.toLocaleLowerCase(locale).includes(search),
          ),
        )
      : group.opts;
    return opts.length ? [{ ...group, opts }] : [];
  });
  return sortByName ? result.sort((a, b) => a.name.localeCompare(b.name, locale)) : result;
}

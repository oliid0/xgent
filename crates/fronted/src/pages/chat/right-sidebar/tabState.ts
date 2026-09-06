/** Preserve creation order across updates from independent browser/file/chat stores. */
export function reconcileTabOrder(previous: readonly string[], available: readonly string[]) {
  const existing = new Set(available);
  const order = previous.filter((id) => existing.has(id));
  const known = new Set(order);
  for (const id of available)
    if (!known.has(id)) {
      order.push(id);
      known.add(id);
    }
  return order;
}

export function resolveActiveTab(
  selected: string | null,
  previous: readonly string[],
  available: readonly string[],
): string | null {
  if (selected && available.includes(selected)) return selected;
  const index = selected ? previous.indexOf(selected) : -1;
  if (index >= 0) {
    return (
      previous.slice(index + 1).find((id) => available.includes(id)) ??
      previous
        .slice(0, index)
        .reverse()
        .find((id) => available.includes(id)) ??
      available[0] ??
      null
    );
  }
  return available[0] ?? null;
}

export function tabForKey(ids: readonly string[], current: string, key: string, rtl = false) {
  const index = ids.indexOf(current);
  if (index < 0 || ids.length === 0) return null;
  if (key === "Home") return ids[0];
  if (key === "End") return ids.at(-1) ?? null;
  const direction = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  return direction ? ids[(index + direction * (rtl ? -1 : 1) + ids.length) % ids.length] : null;
}

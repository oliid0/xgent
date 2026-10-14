/** Untrusted service presence: no credentials, capabilities or task authority. */
export type DiscoveredWorker = { hostId: string; platform: string; urls: string[] };

export function validateWorkerDiscovery(value: unknown): DiscoveredWorker[] {
  const services = (value as { services?: unknown } | null)?.services;
  if (!Array.isArray(services) || services.length > 64)
    throw new Error("Invalid workstation discovery response");
  const result: DiscoveredWorker[] = [];
  for (const item of services) {
    if (
      !item ||
      typeof item.hostId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.hostId) ||
      !["macos", "windows", "linux"].includes(item.platform) ||
      !Array.isArray(item.urls) ||
      !item.urls.length ||
      item.urls.length > 16
    )
      throw new Error("Invalid discovered workstation");
    const urls: string[] = item.urls.map((raw: unknown): string => {
      if (typeof raw !== "string" || raw.length > 256)
        throw new Error("Invalid discovered address");
      const url = new URL(raw);
      const parts = url.hostname.split(".").map(Number);
      const lan =
        parts.length === 4 &&
        parts.every(
          (part, index) =>
            Number.isInteger(part) &&
            part >= 0 &&
            part <= 255 &&
            String(part) === url.hostname.split(".")[index],
        ) &&
        (parts[0] === 10 ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) ||
          (parts[0] === 169 && parts[1] === 254));
      const tailnet =
        parts.length === 4 &&
        parts[0] === 100 &&
        parts[1] >= 64 &&
        parts[1] <= 127 &&
        !(parts[1] === 115 && (parts[2] === 92 || parts[2] === 93)) &&
        url.hostname !== "100.100.100.100";
      if (
        (!lan && !tailnet) ||
        url.protocol !== "http:" ||
        (url.port !== "" && Number(url.port) === 0) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("Invalid discovered workstation endpoint");
      return `http://${url.hostname}:${url.port || "80"}`;
    });
    const previous = result.find((service) => service.hostId === item.hostId);
    if (previous && previous.platform !== item.platform)
      throw new Error("Conflicting workstation presence");
    const sorted = [...new Set([...(previous?.urls ?? []), ...urls])].sort(
      (a, b) =>
        Number(a.startsWith("http://100.")) - Number(b.startsWith("http://100.")) ||
        a.localeCompare(b),
    );
    if (sorted.length > 16) throw new Error("Too many discovered workstation endpoints");
    if (previous) previous.urls = sorted;
    else result.push({ hostId: item.hostId, platform: item.platform, urls: sorted });
  }
  return result;
}

export function discoveredWorkerLabel(item: DiscoveredWorker) {
  return `${item.platform === "macos" ? "macOS" : item.platform === "windows" ? "Windows" : "Linux"} · ${item.hostId.slice(0, 8)}`;
}

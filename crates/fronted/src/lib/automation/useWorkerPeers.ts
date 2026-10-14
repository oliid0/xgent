import { useEffect, useState } from "react";
import { backend } from "./backend";
import type { WorkerPeerList } from "./types";
import { type DiscoveredWorker, validateWorkerDiscovery } from "./workerDiscovery";

/** Discovery belongs to this installation, independently of the chat's PC. */
export function useWorkerPeers(enabled: boolean, onRemoved?: () => Promise<void>) {
  const [catalog, setCatalog] = useState<WorkerPeerList>({ peers: [] });
  const [discovered, setDiscovered] = useState<DiscoveredWorker[]>([]);
  const [discoveryAttempted, setDiscoveryAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [operation] = useState(() => ({
    active: enabled,
    revision: 0,
    busy: "",
    refreshRequested: false,
    discovered: [] as DiscoveredWorker[],
  }));
  operation.active = enabled;

  async function run(id: string, remove?: string, baseUrl?: string) {
    if (!operation.active) return;
    if (operation.busy) {
      if (!remove) operation.refreshRequested = true;
      return;
    }
    const revision = operation.revision;
    const current = () => operation.active && revision === operation.revision;
    operation.busy = id;
    setBusy(id);
    setError("");
    try {
      if (id === "discover") {
        const services = validateWorkerDiscovery(await backend.discoverWorkerPeers());
        if (current()) {
          operation.discovered = services;
          setDiscovered(services);
          setDiscoveryAttempted(true);
        }
        return;
      }
      if (remove) {
        if (baseUrl) await backend.forgetWorkerEndpoint(remove, baseUrl);
        else await backend.forgetWorkerPeer(remove);
        if (!current()) return;
        setCatalog((previous) => ({
          ...previous,
          peers: previous.peers.flatMap((peer) => {
            if (peer.peerId !== remove) return [peer];
            if (!baseUrl || !peer.endpoints) return [];
            const endpoints = peer.endpoints.filter((endpoint) => endpoint.baseUrl !== baseUrl);
            return endpoints.length
              ? [{ ...peer, endpoints, ...(peer.baseUrl === baseUrl ? { online: false } : {}) }]
              : [];
          }),
        }));
        await onRemoved?.();
        if (!current()) return;
      }
      const next = await backend.listWorkerPeers();
      if (!Array.isArray(next?.peers))
        throw new Error("Worker discovery returned an invalid catalog");
      if (current()) setCatalog(next);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      if (current()) {
        operation.busy = "";
        setBusy("");
        if (operation.refreshRequested) {
          operation.refreshRequested = false;
          void run("refresh").catch(() => {});
        }
      }
    }
  }

  useEffect(() => {
    operation.active = enabled;
    operation.revision++;
    operation.busy = "";
    operation.refreshRequested = false;
    operation.discovered = [];
    setDiscovered([]);
    setDiscoveryAttempted(false);
    setBusy("");
    setError("");
    if (enabled) void run("refresh").catch(() => {});
    else setCatalog({ peers: [] });
    return () => {
      operation.active = false;
      operation.revision++;
    };
  }, [enabled]);

  return {
    ...catalog,
    busy,
    error,
    discovered,
    discoveryAttempted,
    discover: () => run("discover"),
    hasDiscoveredEndpoint: (hostId: string, url: string) =>
      operation.active &&
      !operation.busy &&
      operation.discovered.some(
        (service) => service.hostId === hostId && service.urls.includes(url),
      ),
    refresh: () => run("refresh"),
    forget: (id: string) => run(`forget:${id}`, id),
    forgetEndpoint: (id: string, url: string) => run(`forget:${id}:${url}`, id, url),
  };
}

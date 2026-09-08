import {
  type BrowserAction,
  type BrowserActionInput,
  type BrowserActionResponse,
  type BrowserAutomationClient,
  type BrowserSessionSummary,
  type BrowserStatus,
  type BrowserViewport,
  localBrowserAutomationClient,
} from "../browserAutomation";

import { createUuid } from "../shared/id";

const DEFAULT_BROWSER_SESSION_ID = "main";
const DEFAULT_BROWSER_HOME = "about:blank";
export const MAX_BROWSER_SESSIONS = 16;

export type BrowserControllerState = {
  initialized: boolean;
  initializing: boolean;
  status: BrowserStatus | null;
  sessions: BrowserSessionSummary[];
  activeSessionId: string | null;
  panelOpen: boolean;
  panelOpenSource: "agent" | "user" | null;
  busySessionIds: string[];
  humanAssistance: BrowserHumanAssistance | null;
  completedHumanAssistance: Record<string, BrowserHumanAssistanceCompletion>;
  previewDataUrls: Record<string, string>;
  error: string | null;
};

export type BrowserHumanAssistance = {
  sessionId: string;
  sequence: number;
  startedAt: number;
};

export type BrowserHumanAssistanceCompletion = BrowserHumanAssistance & {
  finishedAt: number;
};

export type EnsureBrowserSessionOptions = {
  sessionId?: string;
  url?: string;
  visible?: boolean;
  preserveError?: boolean;
  /** Keep a user-selected visible tab active while an agent works in another session. */
  preserveActive?: boolean;
};

type Listener = () => void;

export const HIDDEN_BROWSER_VIEWPORT: BrowserViewport = {
  x: 0,
  y: 0,
  // Keep a real layout viewport while hidden so DOM geometry and native
  // screenshots remain useful to the agent before the user opens the panel.
  width: 1024,
  height: 768,
  visible: false,
  scaleFactor: 1,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizedSessionId(value: string | undefined) {
  const sessionId = value?.trim() || DEFAULT_BROWSER_SESSION_ID;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
    throw new Error("Browser session_id must use 1-64 ASCII letters, digits, '-' or '_'.");
  }
  return sessionId;
}

export function normalizeBrowserAddress(value: string) {
  const address = value.trim().replace(/^locahost(?=[:/]|$)/i, "localhost");
  if (!address) return DEFAULT_BROWSER_HOME;
  if (/^(?:https?|file):\/\//i.test(address) || address === "about:blank") return address;
  if (/^[a-z]:[\\/]/i.test(address) || address.startsWith("/")) {
    const url = new URL("file:///");
    url.pathname = address.replace(/\\/g, "/");
    return url.href;
  }

  const localHost =
    /^(localhost|0\.0\.0\.0|\[::1\]|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?(?:\/|$)/i.test(
      address,
    );
  if (localHost) return `http://${address}`;
  if (/^[^\s/]+\.[^\s/]+(?:\/|$)/.test(address)) return `https://${address}`;
  return `https://www.google.com/search?q=${encodeURIComponent(address)}`;
}

function mergeSession(
  sessions: BrowserSessionSummary[],
  session: BrowserSessionSummary,
): BrowserSessionSummary[] {
  const index = sessions.findIndex((item) => item.sessionId === session.sessionId);
  if (index < 0) return [...sessions, session];
  const next = [...sessions];
  next[index] = session;
  return next;
}

export class BrowserSessionController {
  constructor(private readonly client: BrowserAutomationClient = localBrowserAutomationClient) {}

  private homePage = DEFAULT_BROWSER_HOME;
  private conversationId = "";
  private readonly sessionOwners = new Map<string, string>();
  private readonly sessionAliases = new Map<string, string>();
  private surfaceOccluded = false;
  private readonly viewports = new Map<string, BrowserViewport>();
  private readonly viewportUpdates = new Map<string, Promise<BrowserSessionSummary | undefined>>();
  private readonly previewRequests = new Map<string, Promise<string | null>>();

  sessionIdForConversation(conversationId: string, requested = "main") {
    if (!conversationId) return requested;
    if (this.sessionOwners.get(requested) === conversationId) return requested;
    const key = JSON.stringify([conversationId, requested]);
    let id = this.sessionAliases.get(key);
    if (!id) {
      id = `c-${createUuid()}`;
      this.sessionAliases.set(key, id);
      this.sessionOwners.set(id, conversationId);
    }
    return id;
  }

  sessionsForConversation(conversationId = this.conversationId) {
    return this.state.sessions.filter(
      (session) => !conversationId || this.sessionOwners.get(session.sessionId) === conversationId,
    );
  }

  selectConversation(conversationId: string) {
    if (this.conversationId === conversationId) return;
    this.closePanel();
    this.conversationId = conversationId;
    this.update({
      activeSessionId: this.sessionsForConversation(conversationId)[0]?.sessionId ?? null,
    });
  }

  setSurfaceOccluded = (occluded: boolean) => {
    this.surfaceOccluded = occluded;
    const id = this.state.activeSessionId;
    const viewport = id ? this.viewports.get(id) : null;
    if (id && viewport) void this.setViewport(id, viewport).catch(() => undefined);
  };
  private state: BrowserControllerState = {
    initialized: false,
    initializing: false,
    status: null,
    sessions: [],
    activeSessionId: null,
    panelOpen: false,
    panelOpenSource: null,
    busySessionIds: [],
    humanAssistance: null,
    completedHumanAssistance: {},
    previewDataUrls: {},
    error: null,
  };

  private readonly listeners = new Set<Listener>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly agentObservations = new Map<
    string,
    { url: string; sequence: number; documentId?: string }
  >();
  private readonly assistanceWaiters = new Map<
    string,
    Set<(assistance: BrowserHumanAssistanceCompletion) => void>
  >();
  private assistanceSequence = 0;
  private initializePromise: Promise<BrowserControllerState> | null = null;
  private readonly openingSessions = new Map<string, Promise<BrowserSessionSummary>>();
  private nextUserTabId = 0;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  configure(options: { homePage?: string }) {
    this.homePage = normalizeBrowserAddress(options.homePage?.trim() || DEFAULT_BROWSER_HOME);
  }

  private update(patch: Partial<BrowserControllerState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setSessionBusy(sessionId: string, busy: boolean) {
    const ids = new Set(this.state.busySessionIds);
    if (busy) ids.add(sessionId);
    else ids.delete(sessionId);
    this.update({ busySessionIds: [...ids] });
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(sessionId, current);
    return current.finally(() => {
      if (this.queues.get(sessionId) === current) this.queues.delete(sessionId);
    });
  }

  async initialize() {
    if (this.state.initialized) return this.state;
    if (this.initializePromise) return this.initializePromise;

    this.update({ initializing: true, error: null });
    this.initializePromise = Promise.all([this.client.status(), this.client.listSessions()])
      .then(([status, sessions]) => {
        const activeSessionId =
          this.state.activeSessionId &&
          sessions.some((session) => session.sessionId === this.state.activeSessionId)
            ? this.state.activeSessionId
            : (sessions.find(
                (session) =>
                  !this.conversationId ||
                  this.sessionOwners.get(session.sessionId) === this.conversationId,
              )?.sessionId ?? null);
        this.update({
          initialized: true,
          initializing: false,
          status,
          sessions,
          activeSessionId,
          error: null,
        });
        return this.state;
      })
      .catch((error) => {
        this.update({
          initialized: false,
          initializing: false,
          error: errorMessage(error),
        });
        throw error;
      })
      .finally(() => {
        this.initializePromise = null;
      });
    return this.initializePromise;
  }

  async refreshSessions() {
    const sessions = await this.client.listSessions();
    const activeSessionId =
      this.state.activeSessionId &&
      sessions.some((session) => session.sessionId === this.state.activeSessionId)
        ? this.state.activeSessionId
        : (sessions.find(
            (session) =>
              !this.conversationId ||
              this.sessionOwners.get(session.sessionId) === this.conversationId,
          )?.sessionId ?? null);
    this.update({ sessions, activeSessionId, error: null });
    return sessions;
  }

  async ensureSession(options: EnsureBrowserSessionOptions = {}) {
    await this.initialize();
    if (this.state.status && !this.state.status.available) {
      throw new Error(this.state.status.detail || "The embedded browser is unavailable.");
    }

    const sessionId = normalizedSessionId(
      options.sessionId ?? this.sessionIdForConversation(this.conversationId),
    );
    if (this.conversationId && this.sessionOwners.get(sessionId) !== this.conversationId)
      options = { ...options, preserveActive: true };
    const existing = this.state.sessions.find((session) => session.sessionId === sessionId);
    const shouldNavigate = Boolean(options.url?.trim());
    if (existing) {
      if (!shouldNavigate) {
        this.update({
          activeSessionId: options.preserveActive ? this.state.activeSessionId : sessionId,
          ...(options.preserveError ? {} : { error: null }),
        });
        return existing;
      }
      const target = normalizeBrowserAddress(options.url || existing.url);
      const response = await this.action(
        "navigate",
        { url: target },
        {
          sessionId,
          preserveActive: options.preserveActive,
        },
      );
      const session: BrowserSessionSummary = {
        ...existing,
        url: response.url || target,
        title: response.title ?? existing.title,
        loading: false,
      };
      this.update({
        sessions: mergeSession(this.state.sessions, session),
        activeSessionId: options.preserveActive ? this.state.activeSessionId : sessionId,
        error: null,
      });
      return session;
    }

    const pending = this.openingSessions.get(sessionId);
    if (pending) return pending;
    if (this.state.sessions.length + this.openingSessions.size >= MAX_BROWSER_SESSIONS) {
      throw new Error(`The embedded browser supports up to ${MAX_BROWSER_SESSIONS} tabs.`);
    }

    let session: BrowserSessionSummary;
    try {
      const opening = this.enqueue(sessionId, () =>
        this.client.openSession({
          sessionId,
          url: normalizeBrowserAddress(options.url || this.homePage),
          viewport: {
            ...HIDDEN_BROWSER_VIEWPORT,
            visible: options.visible === true,
          },
        }),
      );
      this.openingSessions.set(sessionId, opening);
      session = await opening;
    } catch (error) {
      // Native creation may have completed just as an IPC deadline elapsed.
      // Reconcile once before surfacing the error so the next command reuses
      // that exact tab instead of attempting a duplicate child-WebView label.
      const sessions = await this.client.listSessions().catch(() => []);
      const preserved = sessions.find((item) => item.sessionId === sessionId);
      if (preserved) {
        this.update({
          sessions,
          activeSessionId: options.preserveActive ? this.state.activeSessionId : sessionId,
          ...(options.preserveError ? {} : { error: errorMessage(error) }),
        });
      }
      throw error;
    } finally {
      this.openingSessions.delete(sessionId);
    }
    this.update({
      sessions: mergeSession(this.state.sessions, session),
      activeSessionId: options.preserveActive ? this.state.activeSessionId : sessionId,
      ...(options.preserveError ? {} : { error: null }),
    });
    return session;
  }

  async newSession(
    url = this.homePage,
    options: { preserveActive?: boolean; conversationId?: string } = {},
  ) {
    await this.initialize();
    const used = new Set([
      ...this.state.sessions.map((session) => session.sessionId),
      ...this.openingSessions.keys(),
    ]);
    let index = ++this.nextUserTabId;
    while (used.has(`tab-${index}`)) index = ++this.nextUserTabId;
    return this.ensureSession({
      sessionId: this.sessionIdForConversation(
        options.conversationId ?? this.conversationId,
        `tab-${index}`,
      ),
      url,
      preserveActive: options.preserveActive,
    });
  }

  selectSession(sessionId: string) {
    if (!this.sessionsForConversation().some((session) => session.sessionId === sessionId)) return;
    this.update({ activeSessionId: sessionId, error: null });
  }

  openPanel(sessionId?: string, source: "agent" | "user" = "agent") {
    if (
      sessionId &&
      this.conversationId &&
      this.sessionOwners.get(sessionId) !== this.conversationId
    )
      return;
    const nextSessionId =
      sessionId && this.state.sessions.some((session) => session.sessionId === sessionId)
        ? sessionId
        : this.state.activeSessionId;
    this.update({
      panelOpen: true,
      panelOpenSource: source,
      activeSessionId: nextSessionId,
      error: null,
    });
    void this.ensureSession({ sessionId: nextSessionId ?? undefined }).catch((error) => {
      this.update({ error: errorMessage(error) });
    });
  }

  closePanel() {
    if (this.state.humanAssistance) {
      this.finishHumanAssistance(this.state.humanAssistance.sessionId);
    }
    this.update({ panelOpen: false, panelOpenSource: null });
    const activeSessionId = this.state.activeSessionId;
    if (activeSessionId) {
      void this.setViewport(activeSessionId, HIDDEN_BROWSER_VIEWPORT).catch(() => undefined);
    }
  }

  async closeSession(sessionIdInput: string) {
    const sessionId = normalizedSessionId(sessionIdInput);
    this.finishHumanAssistance(sessionId);
    await this.enqueue(sessionId, () => this.client.closeSession(sessionId));
    const sessions = this.state.sessions.filter((session) => session.sessionId !== sessionId);
    const previewDataUrls = { ...this.state.previewDataUrls };
    const completedHumanAssistance = { ...this.state.completedHumanAssistance };
    delete previewDataUrls[sessionId];
    delete completedHumanAssistance[sessionId];
    this.agentObservations.delete(sessionId);
    this.viewports.delete(sessionId);
    this.sessionOwners.delete(sessionId);
    for (const [alias, id] of this.sessionAliases) {
      if (id === sessionId) this.sessionAliases.delete(alias);
    }
    const remaining = sessions.filter(
      (session) =>
        !this.conversationId || this.sessionOwners.get(session.sessionId) === this.conversationId,
    );
    const activeSessionId =
      this.state.activeSessionId === sessionId
        ? (remaining[0]?.sessionId ?? null)
        : this.state.activeSessionId;
    this.update({
      sessions,
      activeSessionId,
      previewDataUrls,
      completedHumanAssistance,
      error: null,
    });
  }

  async closeAllSessions() {
    if (this.state.humanAssistance) {
      this.finishHumanAssistance(this.state.humanAssistance.sessionId);
    }
    const sessionIds = this.state.sessions.map((session) => session.sessionId);
    for (const sessionId of sessionIds) {
      await this.enqueue(sessionId, () => this.client.closeSession(sessionId));
    }
    this.agentObservations.clear();
    this.viewports.clear();
    this.sessionOwners.clear();
    this.sessionAliases.clear();
    this.update({
      sessions: [],
      activeSessionId: null,
      busySessionIds: [],
      humanAssistance: null,
      completedHumanAssistance: {},
      previewDataUrls: {},
      error: null,
    });
  }

  beginHumanAssistance(sessionIdInput?: string) {
    const sessionId = normalizedSessionId(
      sessionIdInput ?? this.state.activeSessionId ?? undefined,
    );
    if (!this.state.sessions.some((session) => session.sessionId === sessionId)) return null;
    if (this.state.humanAssistance?.sessionId === sessionId) return this.state.humanAssistance;
    if (this.state.humanAssistance) {
      this.finishHumanAssistance(this.state.humanAssistance.sessionId);
    }
    const assistance: BrowserHumanAssistance = {
      sessionId,
      sequence: ++this.assistanceSequence,
      startedAt: Date.now(),
    };
    this.update({ humanAssistance: assistance, activeSessionId: sessionId, error: null });
    return assistance;
  }

  finishHumanAssistance(sessionIdInput?: string) {
    const assistance = this.state.humanAssistance;
    if (!assistance) return null;
    if (sessionIdInput && normalizedSessionId(sessionIdInput) !== assistance.sessionId) return null;
    const completion: BrowserHumanAssistanceCompletion = {
      ...assistance,
      finishedAt: Date.now(),
    };
    this.update({
      humanAssistance: null,
      completedHumanAssistance: {
        ...this.state.completedHumanAssistance,
        [assistance.sessionId]: completion,
      },
    });
    const waiters = this.assistanceWaiters.get(assistance.sessionId);
    this.assistanceWaiters.delete(assistance.sessionId);
    for (const resolve of waiters ?? []) resolve(completion);
    return completion;
  }

  isHumanAssistanceActive(sessionIdInput: string) {
    return this.state.humanAssistance?.sessionId === normalizedSessionId(sessionIdInput);
  }

  waitForHumanAssistance(
    sessionIdInput: string,
    timeoutMs = 5 * 60_000,
    signal?: AbortSignal,
  ): Promise<BrowserHumanAssistanceCompletion | null> {
    const sessionId = normalizedSessionId(sessionIdInput);
    const assistance = this.state.humanAssistance;
    if (!assistance || assistance.sessionId !== sessionId) return Promise.resolve(null);
    if (signal?.aborted) return Promise.reject(new Error("Cancelled"));
    return new Promise((resolve, reject) => {
      const waiters = this.assistanceWaiters.get(sessionId) ?? new Set();
      let settled = false;
      let timer: number | undefined;
      const cleanup = () => {
        if (timer !== undefined) window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiters.delete(finish);
        if (waiters.size === 0) this.assistanceWaiters.delete(sessionId);
      };
      const finish = (completed: BrowserHumanAssistanceCompletion) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(completed);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Cancelled"));
      };
      waiters.add(finish);
      this.assistanceWaiters.set(sessionId, waiters);
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(
        () => {
          const current = this.state.humanAssistance;
          if (current?.sessionId === sessionId) this.finishHumanAssistance(sessionId);
        },
        Math.max(1_000, timeoutMs),
      );
    });
  }

  async setViewport(sessionIdInput: string, viewport: BrowserViewport) {
    const sessionId = normalizedSessionId(sessionIdInput);
    this.viewports.set(sessionId, viewport);
    const pending = this.viewportUpdates.get(sessionId);
    if (pending) return pending;
    // Geometry cannot wait behind network navigation or an agent command.
    // Keep one request in flight and discard superseded drag positions.
    const update = async () => {
      let session: BrowserSessionSummary | undefined;
      let desired: BrowserViewport | undefined;
      do {
        desired = this.viewports.get(sessionId);
        if (!desired) break;
        session = await this.client.setViewport(sessionId, {
          ...desired,
          visible:
            desired.visible &&
            !this.surfaceOccluded &&
            (!this.conversationId || this.sessionOwners.get(sessionId) === this.conversationId),
        });
        const visible = session.visible;
        this.update({
          sessions: this.state.sessions.map((current) =>
            current.sessionId === sessionId ? { ...current, visible } : current,
          ),
        });
      } while (this.viewports.get(sessionId) !== desired);
      return session;
    };
    const request = update().finally(() => this.viewportUpdates.delete(sessionId));
    this.viewportUpdates.set(sessionId, request);
    return request;
  }

  async action(
    action: BrowserAction,
    input: BrowserActionInput = {},
    options: {
      sessionId?: string;
      timeoutMs?: number;
      background?: boolean;
      preserveActive?: boolean;
      agent?: boolean;
    } = {},
  ): Promise<BrowserActionResponse> {
    const sessionId = normalizedSessionId(
      options.sessionId ?? this.sessionIdForConversation(this.conversationId),
    );
    const preserveActive =
      options.preserveActive === true ||
      (Boolean(this.conversationId) && this.sessionOwners.get(sessionId) !== this.conversationId) ||
      (this.state.panelOpenSource === "user" &&
        this.state.activeSessionId !== null &&
        this.state.activeSessionId !== sessionId);
    await this.ensureSession({
      sessionId,
      preserveError: options.background,
      preserveActive,
    });
    if (!options.background) this.setSessionBusy(sessionId, true);
    try {
      const response = await this.enqueue(sessionId, async () => {
        const mutating = [
          "click",
          "type",
          "press_key",
          "scroll",
          "hover",
          "navigate",
          "reload",
          "go_back",
          "go_forward",
          "execute_js",
        ].includes(action);
        const observe = (response: BrowserActionResponse) => {
          const data = response.data as
            | { humanIntervention?: { sequence?: number; documentId?: string } }
            | undefined;
          return {
            url: response.url,
            sequence: data?.humanIntervention?.sequence ?? 0,
            documentId: data?.humanIntervention?.documentId,
          };
        };
        let guardedInput = input;
        if (options.agent && mutating) {
          const state = await this.client.action(sessionId, "page_info", {}, options.timeoutMs);
          const current = observe(state);
          const previous = this.agentObservations.get(sessionId);
          if (
            !previous ||
            current.url !== previous.url ||
            current.sequence !== previous.sequence ||
            current.documentId !== previous.documentId
          ) {
            const fresh = await this.client.action(sessionId, "snapshot", {}, options.timeoutMs);
            this.agentObservations.set(sessionId, observe(fresh));
            return {
              ...fresh,
              data: {
                freshState: fresh.data,
                actionApplied: false,
                reason:
                  "The page has changed or has not been observed. Inspect this fresh state and continue; do not repeat work the user already completed.",
              },
            };
          }
          guardedInput = {
            ...input,
            expectedHumanSequence: current.sequence,
            expectedDocumentId: current.documentId,
          };
        }
        const result = await this.client.action(sessionId, action, guardedInput, options.timeoutMs);
        if (options.agent) this.agentObservations.set(sessionId, observe(result));
        if (options.agent && mutating) {
          // Preserve dispatch evidence even if the following observation fails.
          const applied =
            (result.data as { actionApplied?: boolean } | undefined)?.actionApplied !== false;
          let fresh: BrowserActionResponse;
          try {
            fresh = await this.client.action(sessionId, "snapshot", {}, options.timeoutMs);
          } catch (error) {
            this.agentObservations.delete(sessionId);
            return {
              ...result,
              data: {
                result: result.data,
                actionApplied: applied,
                observationError: errorMessage(error),
                reason:
                  "Observe the page before continuing. Do not replay an action merely because its following observation failed.",
              },
            };
          }
          this.agentObservations.set(sessionId, observe(fresh));
          return {
            ...result,
            url: fresh.url,
            title: fresh.title,
            data: { result: result.data, freshState: fresh.data, actionApplied: applied },
          };
        }
        return result;
      });
      if (this.conversationId && this.sessionOwners.get(sessionId) !== this.conversationId)
        options = { ...options, preserveActive: true };
      const existing = this.state.sessions.find((session) => session.sessionId === sessionId);
      const previewDataUrls = response.screenshotBase64
        ? {
            ...this.state.previewDataUrls,
            [sessionId]: `data:image/png;base64,${response.screenshotBase64}`,
          }
        : this.state.previewDataUrls;
      this.update({
        sessions: mergeSession(this.state.sessions, {
          sessionId,
          url: response.url || existing?.url || "",
          title: response.title ?? existing?.title,
          visible: existing?.visible ?? false,
          loading: false,
        }),
        activeSessionId: preserveActive ? this.state.activeSessionId : sessionId,
        previewDataUrls,
        ...(options.background ? {} : { error: null }),
      });
      return response;
    } catch (error) {
      if (!options.background) {
        try {
          await this.refreshSessions();
        } catch {
          // A command failure must remain non-mutating. Keep the original
          // correlated error and the last known session instead of reloading it.
        }
        this.update({ error: errorMessage(error) });
      }
      throw error;
    } finally {
      if (!options.background) this.setSessionBusy(sessionId, false);
    }
  }

  async captureSessionPreview(sessionIdInput: string) {
    const sessionId = normalizedSessionId(sessionIdInput);
    const pending = this.previewRequests.get(sessionId);
    if (pending) return pending;
    const request = this.client
      .action(sessionId, "screenshot", {}, 8_000)
      .then((response) => {
        const image = response.screenshotBase64
          ? `data:image/png;base64,${response.screenshotBase64}`
          : null;
        if (image && this.state.sessions.some((session) => session.sessionId === sessionId)) {
          this.update({ previewDataUrls: { ...this.state.previewDataUrls, [sessionId]: image } });
        }
        return image;
      })
      .finally(() => this.previewRequests.delete(sessionId));
    this.previewRequests.set(sessionId, request);
    return request;
  }

  clearError() {
    this.update({ error: null });
  }
}

export const browserSessionController = new BrowserSessionController();

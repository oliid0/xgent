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

const DEFAULT_BROWSER_SESSION_ID = "main";
const DEFAULT_BROWSER_HOME = "https://www.google.com/";
export const MAX_BROWSER_SESSIONS = 3;

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
  const address = value.trim();
  if (!address) return DEFAULT_BROWSER_HOME;
  if (/^https?:\/\//i.test(address)) return address;

  const localHost =
    /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?(?:\/|$)/i.test(
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
  const next = sessions.filter((item) => item.sessionId !== session.sessionId);
  next.push(session);
  return next.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

export class BrowserSessionController {
  constructor(private readonly client: BrowserAutomationClient = localBrowserAutomationClient) {}

  private homePage = DEFAULT_BROWSER_HOME;
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
  private readonly assistanceWaiters = new Map<
    string,
    Set<(assistance: BrowserHumanAssistanceCompletion) => void>
  >();
  private assistanceSequence = 0;
  private initializePromise: Promise<BrowserControllerState> | null = null;

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
            : (sessions[0]?.sessionId ?? null);
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
        : (sessions[0]?.sessionId ?? null);
    this.update({ sessions, activeSessionId, error: null });
    return sessions;
  }

  async ensureSession(options: EnsureBrowserSessionOptions = {}) {
    await this.initialize();
    if (this.state.status && !this.state.status.available) {
      throw new Error(this.state.status.detail || "The embedded browser is unavailable.");
    }

    const sessionId = normalizedSessionId(options.sessionId);
    const existing = this.state.sessions.find((session) => session.sessionId === sessionId);
    const shouldNavigate = Boolean(options.url?.trim());
    if (existing) {
      if (!shouldNavigate) {
        this.update({
          activeSessionId: sessionId,
          ...(options.preserveError ? {} : { error: null }),
        });
        return existing;
      }
      const target = normalizeBrowserAddress(options.url || existing.url);
      const response = await this.action("navigate", { url: target }, { sessionId });
      const session: BrowserSessionSummary = {
        ...existing,
        url: response.url || target,
        title: response.title ?? existing.title,
        loading: false,
      };
      this.update({
        sessions: mergeSession(this.state.sessions, session),
        activeSessionId: sessionId,
        error: null,
      });
      return session;
    }

    if (this.state.sessions.length >= MAX_BROWSER_SESSIONS) {
      throw new Error(`The embedded browser supports up to ${MAX_BROWSER_SESSIONS} tabs.`);
    }

    let session: BrowserSessionSummary;
    try {
      session = await this.enqueue(sessionId, () =>
        this.client.openSession({
          sessionId,
          url: normalizeBrowserAddress(options.url || this.homePage),
          viewport: {
            ...HIDDEN_BROWSER_VIEWPORT,
            visible: options.visible === true,
          },
        }),
      );
    } catch (error) {
      // Native creation may have completed just as an IPC deadline elapsed.
      // Reconcile once before surfacing the error so the next command reuses
      // that exact tab instead of attempting a duplicate child-WebView label.
      const sessions = await this.client.listSessions().catch(() => []);
      const preserved = sessions.find((item) => item.sessionId === sessionId);
      if (preserved) {
        this.update({
          sessions,
          activeSessionId: sessionId,
          ...(options.preserveError ? {} : { error: errorMessage(error) }),
        });
      }
      throw error;
    }
    this.update({
      sessions: mergeSession(this.state.sessions, session),
      activeSessionId: sessionId,
      ...(options.preserveError ? {} : { error: null }),
    });
    return session;
  }

  async newSession(url = this.homePage) {
    await this.initialize();
    const used = new Set(this.state.sessions.map((session) => session.sessionId));
    let index = 1;
    while (used.has(`tab-${index}`)) index += 1;
    return this.ensureSession({ sessionId: `tab-${index}`, url });
  }

  selectSession(sessionId: string) {
    if (!this.state.sessions.some((session) => session.sessionId === sessionId)) return;
    this.update({ activeSessionId: sessionId, error: null });
  }

  openPanel(sessionId?: string, source: "agent" | "user" = "agent") {
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
    const activeSessionId =
      this.state.activeSessionId === sessionId
        ? (sessions[0]?.sessionId ?? null)
        : this.state.activeSessionId;
    this.update({
      sessions,
      activeSessionId,
      previewDataUrls,
      completedHumanAssistance,
      error: null,
    });
    if (this.state.panelOpen && activeSessionId) {
      await this.ensureSession({ sessionId: activeSessionId });
    } else if (this.state.panelOpen && sessions.length === 0) {
      await this.ensureSession({ sessionId: DEFAULT_BROWSER_SESSION_ID });
    }
  }

  async closeAllSessions() {
    if (this.state.humanAssistance) {
      this.finishHumanAssistance(this.state.humanAssistance.sessionId);
    }
    const sessionIds = this.state.sessions.map((session) => session.sessionId);
    for (const sessionId of sessionIds) {
      await this.enqueue(sessionId, () => this.client.closeSession(sessionId));
    }
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
    const session = await this.enqueue(sessionId, () =>
      this.client.setViewport(sessionId, viewport),
    );
    this.update({ sessions: mergeSession(this.state.sessions, session), error: null });
    return session;
  }

  async action(
    action: BrowserAction,
    input: BrowserActionInput = {},
    options: { sessionId?: string; timeoutMs?: number; background?: boolean } = {},
  ): Promise<BrowserActionResponse> {
    const sessionId = normalizedSessionId(options.sessionId);
    await this.ensureSession({ sessionId, preserveError: options.background });
    if (!options.background) this.setSessionBusy(sessionId, true);
    try {
      const response = await this.enqueue(sessionId, () =>
        this.client.action(sessionId, action, input, options.timeoutMs),
      );
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
        activeSessionId: sessionId,
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
    const response = await this.action(
      "screenshot",
      {},
      {
        sessionId,
        timeoutMs: 8_000,
        background: true,
      },
    );
    return response.screenshotBase64 ? `data:image/png;base64,${response.screenshotBase64}` : null;
  }

  clearError() {
    this.update({ error: null });
  }
}

export const browserSessionController = new BrowserSessionController();

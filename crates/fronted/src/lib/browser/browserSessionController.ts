import {
  type BrowserAction,
  type BrowserActionInput,
  type BrowserActionResponse,
  type BrowserSessionSummary,
  type BrowserStatus,
  type BrowserViewport,
  browserAutomationStatus,
  closeBrowserSession,
  listBrowserSessions,
  openBrowserSession,
  runBrowserAction,
  setBrowserViewport,
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
  busySessionIds: string[];
  error: string | null;
};

export type EnsureBrowserSessionOptions = {
  sessionId?: string;
  url?: string;
  visible?: boolean;
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

class BrowserSessionController {
  private homePage = DEFAULT_BROWSER_HOME;
  private state: BrowserControllerState = {
    initialized: false,
    initializing: false,
    status: null,
    sessions: [],
    activeSessionId: null,
    panelOpen: false,
    busySessionIds: [],
    error: null,
  };

  private readonly listeners = new Set<Listener>();
  private readonly queues = new Map<string, Promise<unknown>>();
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
    this.initializePromise = Promise.all([browserAutomationStatus(), listBrowserSessions()])
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
          initialized: true,
          initializing: false,
          error: errorMessage(error),
        });
        return this.state;
      })
      .finally(() => {
        this.initializePromise = null;
      });
    return this.initializePromise;
  }

  async refreshSessions() {
    const sessions = await listBrowserSessions();
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
        this.update({ activeSessionId: sessionId, error: null });
        return existing;
      }
      const target = normalizeBrowserAddress(options.url || existing.url);
      const response = await this.enqueue(sessionId, () =>
        runBrowserAction(sessionId, "navigate", { url: target }),
      );
      const session: BrowserSessionSummary = {
        ...existing,
        // Native WebViews update their public URL asynchronously after load().
        // Keep the requested target in shared state until the next DOM action
        // reports the committed URL instead of flashing the previous address.
        url: target,
        title: response.title ?? existing.title,
        loading: true,
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

    const session = await this.enqueue(sessionId, () =>
      openBrowserSession({
        sessionId,
        url: normalizeBrowserAddress(options.url || this.homePage),
        viewport: {
          ...HIDDEN_BROWSER_VIEWPORT,
          visible: options.visible === true,
        },
      }),
    );
    this.update({
      sessions: mergeSession(this.state.sessions, session),
      activeSessionId: sessionId,
      error: null,
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

  openPanel(sessionId?: string) {
    const nextSessionId =
      sessionId && this.state.sessions.some((session) => session.sessionId === sessionId)
        ? sessionId
        : this.state.activeSessionId;
    this.update({
      panelOpen: true,
      activeSessionId: nextSessionId,
      error: null,
    });
    void this.ensureSession({ sessionId: nextSessionId ?? undefined }).catch((error) => {
      this.update({ error: errorMessage(error) });
    });
  }

  closePanel() {
    this.update({ panelOpen: false });
    const activeSessionId = this.state.activeSessionId;
    if (activeSessionId) {
      void this.setViewport(activeSessionId, HIDDEN_BROWSER_VIEWPORT).catch(() => undefined);
    }
  }

  async closeSession(sessionIdInput: string) {
    const sessionId = normalizedSessionId(sessionIdInput);
    await this.enqueue(sessionId, () => closeBrowserSession(sessionId));
    const sessions = this.state.sessions.filter((session) => session.sessionId !== sessionId);
    const activeSessionId =
      this.state.activeSessionId === sessionId
        ? (sessions[0]?.sessionId ?? null)
        : this.state.activeSessionId;
    this.update({ sessions, activeSessionId, error: null });
    if (this.state.panelOpen && activeSessionId) {
      await this.ensureSession({ sessionId: activeSessionId });
    } else if (this.state.panelOpen && sessions.length === 0) {
      await this.ensureSession({ sessionId: DEFAULT_BROWSER_SESSION_ID });
    }
  }

  async closeAllSessions() {
    const sessionIds = this.state.sessions.map((session) => session.sessionId);
    for (const sessionId of sessionIds) {
      await this.enqueue(sessionId, () => closeBrowserSession(sessionId));
    }
    this.update({
      sessions: [],
      activeSessionId: null,
      busySessionIds: [],
      error: null,
    });
  }

  async setViewport(sessionIdInput: string, viewport: BrowserViewport) {
    const sessionId = normalizedSessionId(sessionIdInput);
    const session = await this.enqueue(sessionId, () =>
      setBrowserViewport(sessionId, viewport),
    );
    this.update({ sessions: mergeSession(this.state.sessions, session), error: null });
    return session;
  }

  async action(
    action: BrowserAction,
    input: BrowserActionInput = {},
    options: { sessionId?: string; timeoutMs?: number } = {},
  ): Promise<BrowserActionResponse> {
    const sessionId = normalizedSessionId(options.sessionId);
    await this.ensureSession({ sessionId });
    this.setSessionBusy(sessionId, true);
    try {
      const response = await this.enqueue(sessionId, () =>
        runBrowserAction(sessionId, action, input, options.timeoutMs),
      );
      const existing = this.state.sessions.find((session) => session.sessionId === sessionId);
      this.update({
        sessions: mergeSession(this.state.sessions, {
          sessionId,
          url: response.url || existing?.url || "",
          title: response.title ?? existing?.title,
          visible: existing?.visible ?? false,
          loading: false,
        }),
        activeSessionId: sessionId,
        error: null,
      });
      return response;
    } catch (error) {
      this.update({ error: errorMessage(error) });
      throw error;
    } finally {
      this.setSessionBusy(sessionId, false);
    }
  }

  clearError() {
    this.update({ error: null });
  }
}

export const browserSessionController = new BrowserSessionController();

/**
 * Per-tab event storage backed by chrome.storage.session.
 *
 * In-memory maps provide fast synchronous reads. Every mutation is
 * debounce-flushed to chrome.storage.session so events survive MV3
 * service worker termination.  Session storage clears on browser close,
 * which is appropriate for DevTools data.
 */

interface StoredEvent {
  type: string;
  [key: string]: unknown;
}

interface ToolInfo {
  name: string;
  title?: string;
  description: string;
  inputSchema: string;
  annotations?: Record<string, boolean>;
  readOnlyHint?: boolean;
}

const STORAGE_KEY = "webmcp_debugger_events";
const FLUSH_DELAY_MS = 300;

export class EventStore {
  private events = new Map<number, StoredEvent[]>();
  private tools = new Map<number, Map<string, ToolInfo>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private hydratePromise: Promise<void>;

  constructor() {
    this.hydratePromise = this.hydrate();
  }

  /** Wait until session storage has been loaded into memory. */
  ready(): Promise<void> {
    return this.hydratePromise;
  }

  add(tabId: number, event: StoredEvent): void {
    if (!this.events.has(tabId)) {
      this.events.set(tabId, []);
      this.tools.set(tabId, new Map());
    }
    this.events.get(tabId)!.push(event);
    this.applyToolEvent(tabId, event);
    this.schedulePersist();
  }

  getAll(tabId: number): StoredEvent[] {
    return this.events.get(tabId) ?? [];
  }

  getTools(tabId: number): ToolInfo[] {
    return Array.from(this.tools.get(tabId)?.values() ?? []);
  }

  clear(tabId: number): void {
    this.events.set(tabId, []);
    this.tools.set(tabId, new Map());
    this.schedulePersist();
  }

  clearAll(): void {
    this.events.clear();
    this.tools.clear();
    this.schedulePersist();
  }

  /* ── Persistence ────────────────────────────────────────────── */

  private async hydrate(): Promise<void> {
    try {
      const result = await chrome.storage.session.get(STORAGE_KEY);
      const data = result[STORAGE_KEY] as Record<string, StoredEvent[]> | undefined;
      if (data) {
        for (const [key, events] of Object.entries(data)) {
          const tabId = Number(key);
          // Merge: keep any events that arrived before hydration finished
          const existing = this.events.get(tabId) ?? [];
          const merged = [...events, ...existing];
          this.events.set(tabId, merged);
          // Rebuild tool map from full event history
          const toolMap = new Map<string, ToolInfo>();
          this.tools.set(tabId, toolMap);
          for (const event of merged) this.applyToolEventTo(toolMap, event);
        }
      }
    } catch (err) {
      console.warn("[WebMCP Debugger BG] Failed to hydrate from session storage:", err);
    }
  }

  private schedulePersist(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.persist(), FLUSH_DELAY_MS);
  }

  private persist(): void {
    this.flushTimer = null;
    const data: Record<string, StoredEvent[]> = {};
    for (const [tabId, events] of this.events) {
      if (events.length > 0) data[String(tabId)] = events;
    }
    chrome.storage.session.set({ [STORAGE_KEY]: data }).catch((err: unknown) => {
      console.warn("[WebMCP Debugger BG] Failed to persist events:", err);
    });
  }

  /* ── Tool tracking ──────────────────────────────────────────── */

  private applyToolEvent(tabId: number, event: StoredEvent): void {
    let toolMap = this.tools.get(tabId);
    if (!toolMap) {
      toolMap = new Map();
      this.tools.set(tabId, toolMap);
    }
    this.applyToolEventTo(toolMap, event);
  }

  private applyToolEventTo(toolMap: Map<string, ToolInfo>, event: StoredEvent): void {
    if (event.type === "TOOL_REGISTERED" && event.tool) {
      const t = event.tool as {
        name: string;
        title?: string;
        description?: string;
        inputSchema?: unknown;
        annotations?: Record<string, boolean>;
      };
      toolMap.set(t.name, {
        name: t.name,
        ...(t.title && { title: t.title }),
        description: t.description ?? "",
        inputSchema: typeof t.inputSchema === "string" ? t.inputSchema : JSON.stringify(t.inputSchema ?? {}),
        ...(t.annotations && { annotations: t.annotations, readOnlyHint: t.annotations.readOnlyHint === true }),
      });
    } else if (event.type === "TOOL_UNREGISTERED" && typeof event.name === "string") {
      toolMap.delete(event.name);
    } else if (event.type === "CONTEXT_CLEARED" || event.type === "PAGE_RELOAD") {
      toolMap.clear();
    }
  }
}

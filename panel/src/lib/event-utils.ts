/** Shared utilities for event display across the v2 panel. */

export interface InspectorEvent {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

export type EventCategory = "AI" | "Tool" | "WebMCP" | "Event" | "System";

export const CATEGORY_TYPES: Record<EventCategory, string[]> = {
  AI: ["SESSION_CREATED", "PROMPT_SENT", "PROMPT_RESPONSE", "PROMPT_ERROR", "STREAM_START", "STREAM_END"],
  Tool: ["TOOL_CALL", "TOOL_RESULT_AI"],
  WebMCP: ["TOOL_REGISTERED", "TOOL_UNREGISTERED", "CONTEXT_CLEARED"],
  Event: ["TOOL_ACTIVATED", "TOOL_CANCEL"],
  System: ["PAGE_RELOAD"],
};

const TYPE_TO_CATEGORY: Record<string, EventCategory> = {};
for (const [cat, types] of Object.entries(CATEGORY_TYPES)) {
  for (const t of types) TYPE_TO_CATEGORY[t] = cat as EventCategory;
}

export function getCategory(type: string): EventCategory {
  return TYPE_TO_CATEGORY[type] ?? "System";
}

export const TYPE_COLORS: Record<string, string> = {
  SESSION_CREATED: "#2196f3",
  PROMPT_SENT: "#ff9800",
  PROMPT_RESPONSE: "#4caf50",
  PROMPT_ERROR: "#f44336",
  STREAM_START: "#9c27b0",
  STREAM_END: "#9c27b0",
  TOOL_CALL: "#ff5722",
  TOOL_RESULT_AI: "#8bc34a",
  TOOL_REGISTERED: "#4caf50",
  TOOL_UNREGISTERED: "#f44336",
  CONTEXT_CLEARED: "#ff5722",
  TOOL_ACTIVATED: "#00bcd4",
  TOOL_CANCEL: "#e91e63",
  PAGE_RELOAD: "#607d8b",
};

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  AI: "#2196f3",
  Tool: "#ff5722",
  WebMCP: "#4caf50",
  Event: "#00bcd4",
  System: "#607d8b",
};

/** Human-readable name/label for an event (shown in the Name column). */
export function getEventName(e: InspectorEvent): string {
  switch (e.type) {
    case "SESSION_CREATED":
      return `Session #${String(e.sessionId ?? "").slice(0, 8)}`;
    case "PROMPT_SENT":
    case "STREAM_START":
      return truncate(String(e.input ?? ""), 60);
    case "PROMPT_RESPONSE":
    case "STREAM_END":
      return truncate(String(e.result ?? ""), 60);
    case "PROMPT_ERROR":
      return truncate(String(e.error ?? "error"), 60);
    case "TOOL_CALL":
    case "TOOL_RESULT_AI":
      return String(e.tool ?? "unknown");
    case "TOOL_REGISTERED": {
      const tool = e.tool as Record<string, unknown> | undefined;
      return String(tool?.name ?? "unknown");
    }
    case "TOOL_UNREGISTERED":
      return String(e.name ?? "unknown");
    case "CONTEXT_CLEARED":
      return "(all tools)";
    case "TOOL_ACTIVATED":
    case "TOOL_CANCEL":
      return String(e.toolName ?? "unknown");
    case "PAGE_RELOAD":
      return "(navigation)";
    default:
      return e.type;
  }
}

/** Short status indicator for the event. */
export function getEventStatus(e: InspectorEvent): { label: string; color: string } {
  switch (e.type) {
    case "PROMPT_ERROR":
      return { label: "error", color: "#f44336" };
    case "PROMPT_RESPONSE":
    case "STREAM_END":
      return { label: "ok", color: "#4caf50" };
    case "TOOL_RESULT_AI":
      if (e.error != null && e.error !== "") return { label: "error", color: "#f44336" };
      if (e.result == null) return { label: "empty", color: "#ff9800" };
      return { label: "ok", color: "#4caf50" };
    case "PROMPT_SENT":
    case "STREAM_START":
    case "TOOL_CALL":
      return { label: "sent", color: "#ff9800" };
    case "SESSION_CREATED":
      return { label: "new", color: "#2196f3" };
    case "TOOL_REGISTERED":
      return { label: "+", color: "#4caf50" };
    case "TOOL_UNREGISTERED":
      return { label: "−", color: "#f44336" };
    case "CONTEXT_CLEARED":
      return { label: "clear", color: "#ff5722" };
    case "PAGE_RELOAD":
      return { label: "reload", color: "#607d8b" };
    default:
      return { label: "—", color: "#999" };
  }
}

/** Returns true if the event itself represents a failure. */
export function isEventError(e: InspectorEvent): boolean {
  if (e.type === "PROMPT_ERROR") return true;
  if (e.type === "TOOL_RESULT_AI" && e.error != null && e.error !== "") return true;
  return false;
}

/** Extract the payload/input data for the Payload tab. */
export function getPayload(e: InspectorEvent): Record<string, unknown> | null {
  switch (e.type) {
    case "SESSION_CREATED":
      return { options: e.options, quotaUsage: e.quotaUsage };
    case "PROMPT_SENT":
    case "STREAM_START":
      return { input: e.input, opts: e.opts };
    case "TOOL_CALL":
      return { tool: e.tool, args: e.args };
    case "TOOL_REGISTERED":
      return e.tool as Record<string, unknown>;
    case "TOOL_UNREGISTERED":
      return { name: e.name };
    case "TOOL_ACTIVATED":
    case "TOOL_CANCEL":
      return { toolName: e.toolName };
    default:
      return null;
  }
}

/** Extract the response data for the Response tab. */
export function getResponse(e: InspectorEvent): Record<string, unknown> | null {
  switch (e.type) {
    case "PROMPT_RESPONSE":
    case "STREAM_END":
      return { result: e.result };
    case "PROMPT_ERROR":
      return { error: e.error };
    case "TOOL_RESULT_AI":
      return { tool: e.tool, result: e.result, error: e.error };
    default:
      return null;
  }
}

/** Metadata/headers for the event. */
export function getHeaders(e: InspectorEvent): Array<[string, string]> {
  const headers: Array<[string, string]> = [];
  headers.push(["Type", e.type]);
  headers.push(["Category", getCategory(e.type)]);
  if (e.ts) headers.push(["Timestamp", new Date(e.ts as number).toISOString()]);
  if (e.sessionId) headers.push(["Session ID", String(e.sessionId)]);
  if (e.type === "TOOL_CALL" || e.type === "TOOL_RESULT_AI") {
    headers.push(["Tool", String(e.tool ?? "")]);
  }
  if (e.type === "TOOL_REGISTERED") {
    const tool = e.tool as Record<string, unknown> | undefined;
    if (tool) {
      headers.push(["Tool Name", String(tool.name ?? "")]);
      headers.push(["Description", String(tool.description ?? "")]);
    }
  }
  return headers;
}

export function formatTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Approximate byte size of the event data. */
export function getDataSize(e: InspectorEvent): string {
  const { type: _t, ts: _ts, ...rest } = e; // eslint-disable-line @typescript-eslint/no-unused-vars
  const json = JSON.stringify(rest);
  const bytes = new Blob([json]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Merges raw inspector events into paired entries.
 *
 * Request/response pairs (PROMPT_SENT+PROMPT_RESPONSE, STREAM_START+STREAM_END,
 * TOOL_CALL+TOOL_RESULT_AI) are combined into single MergedEntry rows.
 * Standalone events become entries with only a `request` field.
 */

import type { InspectorEvent, EventCategory } from "./event-utils.js";
import {
  TYPE_COLORS,
  CATEGORY_COLORS,
  getCategory,
  getEventName,
  getEventStatus,
  isEventError,
  getPayload,
  getResponse,
  getHeaders,
  formatTime,
} from "./event-utils.js";

/* ── Types ────────────────────────────────────────────────────── */

export interface MergedEntry {
  id: number;
  request: InspectorEvent;
  response?: InspectorEvent;
}

/* ── Pairing tables ───────────────────────────────────────────── */

const REQUEST_PAIR: Record<string, string> = {
  PROMPT_SENT: "prompt",
  STREAM_START: "stream",
  TOOL_CALL: "tool",
};

const RESPONSE_PAIR: Record<string, string> = {
  PROMPT_RESPONSE: "prompt",
  PROMPT_ERROR: "prompt",
  STREAM_END: "stream",
  TOOL_RESULT_AI: "tool",
};

function matchKey(event: InspectorEvent, pairType: string): string {
  const sid = String(event.sessionId ?? "");
  if (pairType === "tool") return `tool:${sid}:${String(event.tool ?? "")}`;
  return `${pairType}:${sid}`;
}

/* ── Merge function ───────────────────────────────────────────── */

export function mergeEvents(events: InspectorEvent[]): MergedEntry[] {
  const entries: MergedEntry[] = [];
  const pending = new Map<string, number>();
  let nextId = 0;

  for (const event of events) {
    const resPair = RESPONSE_PAIR[event.type];
    if (resPair) {
      const key = matchKey(event, resPair);
      const idx = pending.get(key);
      if (idx !== undefined) {
        entries[idx].response = event;
        pending.delete(key);
        continue;
      }
    }

    const idx = entries.length;
    entries.push({ id: nextId++, request: event });

    const reqPair = REQUEST_PAIR[event.type];
    if (reqPair) {
      pending.set(matchKey(event, reqPair), idx);
    }
  }

  return entries;
}

/* ── Entry-level display helpers ──────────────────────────────── */

const PAIRED_LABELS: Record<string, string> = {
  PROMPT_SENT: "PROMPT",
  STREAM_START: "STREAM",
  TOOL_CALL: "TOOL_CALL",
};

export function getEntryType(e: MergedEntry): string {
  return PAIRED_LABELS[e.request.type] ?? e.request.type;
}

export function getEntryColor(e: MergedEntry): string {
  return TYPE_COLORS[e.request.type] ?? "#999";
}

export function getEntryName(e: MergedEntry): string {
  return getEventName(e.request);
}

export function getEntryCategory(e: MergedEntry): EventCategory {
  return getCategory(e.request.type);
}

export function getEntryCategoryColor(e: MergedEntry): string {
  return CATEGORY_COLORS[getEntryCategory(e)];
}

export function getEntryStatus(e: MergedEntry): { label: string; color: string } {
  if (e.response) return getEventStatus(e.response);
  if (REQUEST_PAIR[e.request.type]) return { label: "pending", color: "#ff9800" };
  return getEventStatus(e.request);
}

/**
 * Determines if an entry represents a failure:
 * - Response is an error (PROMPT_ERROR, TOOL_RESULT_AI with error)
 * - Request was sent but no response paired (still pending / timed out)
 */
export function isEntryFailed(e: MergedEntry): boolean {
  if (e.response && isEventError(e.response)) return true;
  if (isEventError(e.request)) return true;
  if (REQUEST_PAIR[e.request.type] && !e.response) return true;
  return false;
}

export function getEntryTime(e: MergedEntry): string {
  return formatTime(e.request.ts);
}

export function getEntrySize(e: MergedEntry): string {
  let bytes = jsonLen(e.request);
  if (e.response) bytes += jsonLen(e.response);
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function getEntryDuration(e: MergedEntry): string | null {
  if (!e.response) return null;
  const start = e.request.ts;
  const end = e.response.ts;
  if (typeof start !== "number" || typeof end !== "number") return null;
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function getEntryPayload(e: MergedEntry): Record<string, unknown> | null {
  return getPayload(e.request);
}

export function getEntryResponseData(e: MergedEntry): Record<string, unknown> | null {
  if (e.response) return getResponse(e.response);
  return getResponse(e.request);
}

export function getEntryHeaders(e: MergedEntry): Array<[string, string]> {
  const headers = getHeaders(e.request);
  if (e.response) {
    const resTs = e.response.ts;
    if (typeof resTs === "number") headers.push(["Response Time", new Date(resTs).toISOString()]);
    const dur = getEntryDuration(e);
    if (dur) headers.push(["Duration", dur]);
  }
  return headers;
}

/* ── Internal ─────────────────────────────────────────────────── */

function jsonLen(ev: InspectorEvent): number {
  const { type: _, ts: __, ...rest } = ev; // eslint-disable-line @typescript-eslint/no-unused-vars
  return JSON.stringify(rest).length;
}

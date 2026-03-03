import { useState } from "react";
import type { MergedEntry } from "../lib/merge-events.js";
import {
  getEntryType,
  getEntryColor,
  getEntryName,
  getEntryCategory,
  getEntryStatus,
  getEntrySize,
  getEntryDuration,
  getEntryPayload,
  getEntryResponseData,
  getEntryHeaders,
  isEntryFailed,
} from "../lib/merge-events.js";
import { formatTime } from "../lib/event-utils.js";

/* ── Types ────────────────────────────────────────────────────── */

interface EventDetailProps {
  entry: MergedEntry;
  onClose: () => void;
  onExecuteTool?: (name: string, args: Record<string, unknown>) => void;
}

const TABS = ["Headers", "Payload", "Response", "Timing", "Tool"] as const;
type Tab = (typeof TABS)[number];

/* ── Main component ───────────────────────────────────────────── */

export function EventDetail({ entry, onClose, onExecuteTool }: EventDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Headers");
  const color = getEntryColor(entry);
  const toolInfo = extractToolInfo(entry);
  const isToolRelated = toolInfo !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderLeft: "1px solid #e0e0e0", background: "#fff", fontSize: 11 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e0e0e0", background: "#f8f8f8", flexShrink: 0 }}>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {TABS.map((tab) => {
            const hidden = tab === "Tool" && !isToolRelated;
            if (hidden) return null;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "5px 10px",
                  border: "none",
                  borderBottom: activeTab === tab ? "2px solid #1a73e8" : "2px solid transparent",
                  background: "none",
                  color: activeTab === tab ? "#1a73e8" : "#666",
                  fontWeight: activeTab === tab ? 600 : 400,
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                {tab}
                {tab === "Tool" && toolInfo && (
                  <span style={{ marginLeft: 3, fontSize: 9, color: "#4caf50", fontWeight: 500 }}>{toolInfo.name}</span>
                )}
              </button>
            );
          })}
        </div>
        <button onClick={onClose} style={{ padding: "2px 8px", border: "none", background: "none", color: "#999", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }} title="Close">
          ×
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {activeTab === "Headers" && <HeadersView entry={entry} color={color} />}
        {activeTab === "Payload" && <PayloadView entry={entry} />}
        {activeTab === "Response" && <ResponseView entry={entry} />}
        {activeTab === "Timing" && <TimingView entry={entry} />}
        {activeTab === "Tool" && toolInfo && <ToolView toolInfo={toolInfo} onExecute={onExecuteTool} />}
      </div>
    </div>
  );
}

/* ── Headers Tab ──────────────────────────────────────────────── */

function HeadersView({ entry, color }: { entry: MergedEntry; color: string }) {
  const headers = getEntryHeaders(entry);
  const status = getEntryStatus(entry);
  const name = getEntryName(entry);
  const displayType = getEntryType(entry);
  const failed = isEntryFailed(entry);
  const isPending = failed && !entry.response;

  return (
    <div>
      {failed && (
        <ErrorBanner>
          {isPending
            ? "No response received — request may have timed out."
            : `Response returned with error: ${status.label}`}
        </ErrorBanner>
      )}
      <SectionHeader>General</SectionHeader>
      <div style={{ marginBottom: 12 }}>
        <InfoRow label="Event Type">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <strong>{displayType}</strong>
            {entry.response && <span style={{ fontSize: 10, color: "#999" }}> (paired)</span>}
          </span>
        </InfoRow>
        <InfoRow label="Name">{name}</InfoRow>
        <InfoRow label="Status">
          <span style={{ color: status.color, fontWeight: 500 }}>{status.label}</span>
        </InfoRow>
        <InfoRow label="Category">{getEntryCategory(entry)}</InfoRow>
        <InfoRow label="Size">{getEntrySize(entry)}</InfoRow>
        {getEntryDuration(entry) && (
          <InfoRow label="Duration">{getEntryDuration(entry)}</InfoRow>
        )}
      </div>

      <SectionHeader>Event Headers</SectionHeader>
      <div>
        {headers.map(([key, value]) => (
          <InfoRow key={key} label={key}>{value}</InfoRow>
        ))}
      </div>
    </div>
  );
}

/* ── Payload Tab ──────────────────────────────────────────────── */

function PayloadView({ entry }: { entry: MergedEntry }) {
  const payload = getEntryPayload(entry);
  if (!payload) return <EmptyState>No payload data for this event type.</EmptyState>;
  return (
    <div>
      <SectionHeader>Request Payload</SectionHeader>
      <JsonBlock data={payload} />
    </div>
  );
}

/* ── Response Tab ─────────────────────────────────────────────── */

function ResponseView({ entry }: { entry: MergedEntry }) {
  const response = getEntryResponseData(entry);
  const failed = isEntryFailed(entry);
  const isPending = !!entry.request.type.match(/^(PROMPT_SENT|STREAM_START|TOOL_CALL)$/);

  if (!response && !failed) {
    return (
      <EmptyState>
        {isPending && !entry.response ? "Waiting for response…" : "No response data for this event type."}
      </EmptyState>
    );
  }

  if (!response && isPending && !entry.response) {
    return (
      <div>
        <ErrorBanner>
          No response received. The request may have timed out or the page was navigated away.
        </ErrorBanner>
        <SectionHeader>Request Summary</SectionHeader>
        <InfoRow label="Type">{entry.request.type}</InfoRow>
        <InfoRow label="Status"><span style={{ color: "#ff9800", fontWeight: 500 }}>pending (no response)</span></InfoRow>
        {entry.request.ts && (
          <InfoRow label="Sent at">{formatTime(entry.request.ts as number)}</InfoRow>
        )}
      </div>
    );
  }

  const errorContent = response?.error as string | undefined;
  const resultContent = response?.result as string | undefined;
  const hasError = errorContent != null && errorContent !== "";

  return (
    <div>
      {hasError && (
        <ErrorBanner>{typeof errorContent === "string" ? errorContent : "An error occurred"}</ErrorBanner>
      )}
      {typeof resultContent === "string" && (
        <>
          <SectionHeader>Response Body</SectionHeader>
          <pre style={preStyle}>{resultContent}</pre>
        </>
      )}
      {typeof errorContent === "string" && (
        <>
          <SectionHeader>Error Details</SectionHeader>
          <pre style={errorPreStyle}>{errorContent}</pre>
        </>
      )}
      {response && (
        <>
          <SectionHeader>Response Data</SectionHeader>
          <JsonBlock data={response} />
        </>
      )}
    </div>
  );
}

/* ── Timing Tab ───────────────────────────────────────────────── */

function TimingView({ entry }: { entry: MergedEntry }) {
  const reqTs = entry.request.ts as number | undefined;
  const resTs = entry.response?.ts as number | undefined;
  const duration = getEntryDuration(entry);

  return (
    <div>
      <SectionHeader>Timing</SectionHeader>
      <InfoRow label="Request Time">{reqTs ? formatTime(reqTs) : "—"}</InfoRow>
      <InfoRow label="Request ISO">{reqTs ? new Date(reqTs).toISOString() : "—"}</InfoRow>
      {entry.response && (
        <>
          <InfoRow label="Response Time">{resTs ? formatTime(resTs) : "—"}</InfoRow>
          <InfoRow label="Response ISO">{resTs ? new Date(resTs).toISOString() : "—"}</InfoRow>
        </>
      )}
      <InfoRow label="Duration">{duration ?? (entry.response ? "—" : "Pending…")}</InfoRow>
      {typeof entry.request.sessionId === "string" && (
        <InfoRow label="Session">{entry.request.sessionId}</InfoRow>
      )}

      {/* Duration bar */}
      {duration && reqTs && resTs && (
        <div style={{ marginTop: 12 }}>
          <SectionHeader>Duration Bar</SectionHeader>
          <div style={{ background: "#f0f0f0", borderRadius: 3, height: 20, position: "relative", overflow: "hidden", marginTop: 4 }}>
            <div
              style={{
                background: "#1a73e8",
                height: "100%",
                width: "100%",
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 9,
                fontWeight: 600,
              }}
            >
              {duration}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tool Tab (log-based) ─────────────────────────────────────── */

/** All tool-related data extracted from the logged event pair. */
interface LoggedToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  readOnlyHint?: boolean;
  args?: unknown;
  result?: unknown;
  error?: string;
  sessionId?: string;
  eventType: string;
}

/** Extract tool info entirely from the logged event data. */
function extractToolInfo(entry: MergedEntry): LoggedToolInfo | null {
  const req = entry.request;
  const res = entry.response;

  if (req.type === "TOOL_REGISTERED") {
    const t = req.tool as Record<string, unknown> | undefined;
    if (!t?.name) return null;
    const annotations = t.annotations as Record<string, unknown> | undefined;
    return {
      name: String(t.name),
      description: t.description ? String(t.description) : undefined,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
      readOnlyHint: (t.readOnlyHint === true) || (annotations?.readOnlyHint === true) || undefined,
      eventType: req.type,
    };
  }

  if (req.type === "TOOL_UNREGISTERED") {
    return { name: String(req.name ?? ""), eventType: req.type };
  }

  if (req.type === "TOOL_REGISTER_ERROR" || req.type === "TOOL_UNREGISTER_ERROR") {
    return {
      name: String(req.name ?? ""),
      error: req.error != null ? String(req.error) : "Unknown error",
      eventType: req.type,
    };
  }

  if (req.type === "TOOL_CALL") {
    const info: LoggedToolInfo = {
      name: String(req.tool ?? ""),
      args: req.args,
      sessionId: req.sessionId ? String(req.sessionId) : undefined,
      eventType: req.type,
    };
    if (res?.type === "TOOL_RESULT_AI") {
      info.result = res.result;
      info.error = res.error != null ? String(res.error) : undefined;
    }
    return info;
  }

  if (req.type === "TOOL_RESULT_AI") {
    return {
      name: String(req.tool ?? ""),
      result: req.result,
      error: req.error != null ? String(req.error) : undefined,
      sessionId: req.sessionId ? String(req.sessionId) : undefined,
      eventType: req.type,
    };
  }

  if (req.type === "TOOL_ACTIVATED" || req.type === "TOOL_CANCEL") {
    return { name: String(req.toolName ?? ""), eventType: req.type };
  }

  return null;
}

function ToolView({ toolInfo, onExecute }: {
  toolInfo: LoggedToolInfo;
  onExecute?: (name: string, args: Record<string, unknown>) => void;
}) {
  const [argsText, setArgsText] = useState(() =>
    toolInfo.args ? JSON.stringify(toolInfo.args, null, 2) : "{}",
  );
  const hasError = toolInfo.error != null;

  return (
    <div>
      {/* Error banner at top if tool call failed */}
      {hasError && <ErrorBanner>{toolInfo.error}</ErrorBanner>}

      {/* Tool identity */}
      <SectionHeader>Tool</SectionHeader>
      <InfoRow label="Name">
        <strong style={{ color: hasError ? "#f44336" : "#4caf50" }}>{toolInfo.name}</strong>
      </InfoRow>
      {toolInfo.description && (
        <InfoRow label="Description">{toolInfo.description}</InfoRow>
      )}
      <InfoRow label="Event">{toolInfo.eventType}</InfoRow>
      {toolInfo.readOnlyHint != null && (
        <InfoRow label="Read-Only">
          <span style={{
            display: "inline-block",
            padding: "1px 6px",
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 600,
            background: toolInfo.readOnlyHint ? "#e8f5e9" : "#fff3e0",
            color: toolInfo.readOnlyHint ? "#2e7d32" : "#e65100",
          }}>
            {toolInfo.readOnlyHint ? "yes" : "no"}
          </span>
        </InfoRow>
      )}
      {toolInfo.sessionId && (
        <InfoRow label="Session">
          <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 10 }}>{toolInfo.sessionId}</span>
        </InfoRow>
      )}

      {/* Input Schema (from TOOL_REGISTERED) */}
      {toolInfo.inputSchema != null && (
        <>
          <SectionHeader style={{ marginTop: 12 }}>Input Schema</SectionHeader>
          <pre style={preStyle}>{formatJson(toolInfo.inputSchema)}</pre>
        </>
      )}

      {/* Annotations (from TOOL_REGISTERED) */}
      {toolInfo.annotations != null && (
        <>
          <SectionHeader style={{ marginTop: 12 }}>Annotations</SectionHeader>
          <pre style={preStyle}>{formatJson(toolInfo.annotations)}</pre>
        </>
      )}

      {/* Re-execute (only for TOOL_CALL / TOOL_RESULT_AI where args exist) */}
      {onExecute && toolInfo.name && toolInfo.eventType !== "TOOL_REGISTERED" && (
        <>
          <SectionHeader style={{ marginTop: 12 }}>Re-execute</SectionHeader>
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              height: 80,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: 10,
              padding: 6,
              borderRadius: 4,
              border: "1px solid #ddd",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => {
              try {
                const parsed = JSON.parse(argsText);
                onExecute(toolInfo.name, parsed);
              } catch {
                // invalid JSON
              }
            }}
            style={{
              marginTop: 4,
              padding: "4px 14px",
              background: "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "inherit",
            }}
          >
            Execute
          </button>
        </>
      )}
    </div>
  );
}

/* ── Shared primitives ────────────────────────────────────────── */

function SectionHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontWeight: 600, fontSize: 11, color: "#333", padding: "6px 0 4px", borderBottom: "1px solid #f0f0f0", marginBottom: 4, ...style }}>
      {children}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", borderBottom: "1px solid #f8f8f8", gap: 8 }}>
      <span style={{ color: "#888", minWidth: 90, fontWeight: 500, flexShrink: 0 }}>{label}:</span>
      <span style={{ color: "#333", wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  return <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#999", padding: 20, textAlign: "center", fontSize: 11 }}>{children}</div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff5f5",
      border: "1px solid #fecaca",
      borderRadius: 4,
      padding: "8px 12px",
      marginBottom: 12,
      color: "#b91c1c",
      fontSize: 11,
      fontWeight: 500,
      display: "flex",
      alignItems: "flex-start",
      gap: 6,
    }}>
      <span style={{ flexShrink: 0, fontSize: 13 }}>✕</span>
      <span style={{ wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

function formatJson(data: unknown): string {
  if (typeof data === "string") {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}

const preStyle: React.CSSProperties = {
  background: "#f5f5f5",
  padding: 8,
  borderRadius: 4,
  fontSize: 10,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  margin: "4px 0 12px",
  maxHeight: 300,
};

const errorPreStyle: React.CSSProperties = {
  ...preStyle,
  background: "#fff5f5",
  border: "1px solid #fecaca",
  color: "#b91c1c",
};

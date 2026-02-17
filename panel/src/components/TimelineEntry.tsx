import { useState } from "react";

interface TimelineEntryProps {
  event: {
    type: string;
    ts?: number;
    [key: string]: unknown;
  };
}

const TYPE_COLORS: Record<string, string> = {
  TOOL_REGISTERED: "#4caf50",
  TOOL_UNREGISTERED: "#f44336",
  CONTEXT_CLEARED: "#ff5722",
  SESSION_CREATED: "#2196f3",
  PROMPT_SENT: "#ff9800",
  PROMPT_RESPONSE: "#4caf50",
  PROMPT_ERROR: "#f44336",
  STREAM_START: "#9c27b0",
  STREAM_END: "#9c27b0",
  TOOL_CALL: "#ff5722",
  TOOL_RESULT_AI: "#8bc34a",
  TOOL_ACTIVATED: "#00bcd4",
  TOOL_CANCEL: "#e91e63",
  PAGE_RELOAD: "#607d8b",
};

export function TimelineEntry({ event }: TimelineEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLORS[event.type] ?? "#999";
  const ts = event.ts ? new Date(event.ts as number).toLocaleTimeString() : "";

  const { type, ts: _ts, ...rest } = event; // eslint-disable-line @typescript-eslint/no-unused-vars

  return (
    <div
      style={{ borderLeft: `3px solid ${color}`, padding: "4px 8px", marginBottom: 2, cursor: "pointer", background: expanded ? "#f8f8f8" : "transparent" }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>
          <span style={{ color, fontWeight: 600, fontSize: 11 }}>{type}</span>
          {event.sessionId != null ? <span style={{ color: "#999", fontSize: 10, marginLeft: 6 }}>#{String(event.sessionId).slice(0, 8)}</span> : null}
          {event.tool != null ? <span style={{ color: "#666", fontSize: 11, marginLeft: 6 }}>{String(event.tool)}</span> : null}
          {event.name != null ? <span style={{ color: "#666", fontSize: 11, marginLeft: 6 }}>{String(event.name)}</span> : null}
        </span>
        <span style={{ color: "#aaa", fontSize: 10 }}>{ts}</span>
      </div>
      {expanded && Object.keys(rest).length > 0 && (
        <pre style={{ margin: "4px 0 0", fontSize: 10, color: "#555", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {JSON.stringify(rest, null, 2)}
        </pre>
      )}
    </div>
  );
}

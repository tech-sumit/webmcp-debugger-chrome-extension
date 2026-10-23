/**
 * ISOLATED world content script — declared in manifest content_scripts.
 *
 * Receives events from the MAIN world ai-interceptor via window.postMessage
 * and forwards them to the background service worker via chrome.runtime.sendMessage.
 *
 * Also listens for WebMCP toolactivated / toolcancel events, which the spec
 * fires at document.modelContext (older Chrome builds fired them at window).
 */

/** Send to background, logging errors when the service worker is inactive. */
function forward(msg: Record<string, unknown>) {
  try {
    chrome.runtime?.sendMessage(msg).catch((err: unknown) => {
      console.warn("[WebMCP Debugger Bridge] sendMessage failed:", err);
    });
  } catch (err) {
    console.warn("[WebMCP Debugger Bridge] Extension context invalidated:", err);
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== "webmcp-debugger") return;

  forward({
    source: "webmcp-debugger",
    type: event.data.type,
    data: event.data.data,
  });
});

interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: unknown;
  origin?: string;
  annotations?: Record<string, boolean>;
}

interface SpecModelContext extends EventTarget {
  getTools?: () => Promise<RegisteredTool[]>;
  executeTool?: (tool: RegisteredTool, input?: unknown) => Promise<string>;
}

interface LegacyModelContextTesting {
  listTools: () => Array<Record<string, unknown>>;
  executeTool: (name: string, args: string) => Promise<string | null>;
}

/** The spec's document.modelContext, if it exposes getTools/executeTool. */
function specModelContext(): SpecModelContext | undefined {
  const mc = (document as unknown as { modelContext?: SpecModelContext }).modelContext;
  return mc && typeof mc.getTools === "function" ? mc : undefined;
}

/** The legacy testing API (removed in Chrome 152). */
function legacyTesting(): LegacyModelContextTesting | undefined {
  return (navigator as unknown as { modelContextTesting?: LegacyModelContextTesting })
    .modelContextTesting;
}

function forwardToolEvent(type: "TOOL_ACTIVATED" | "TOOL_CANCEL") {
  return ((event: Event & { toolName?: string; detail?: { toolName?: string } }) => {
    const toolName = event.toolName ?? event.detail?.toolName ?? "unknown";
    forward({
      source: "webmcp-debugger",
      type,
      data: { toolName, ts: Date.now() },
    });
  }) as EventListener;
}

// Spec: ToolActivatedEvent / ToolCancelEvent are dispatched at document.modelContext
const eventTarget: EventTarget =
  (document as unknown as { modelContext?: EventTarget }).modelContext ?? window;
eventTarget.addEventListener("toolactivated", forwardToolEvent("TOOL_ACTIVATED"));
eventTarget.addEventListener("toolcancel", forwardToolEvent("TOOL_CANCEL"));

/** Execute a tool by name via document.modelContext, or the legacy testing API. */
async function executeTool(name: string, inputArgs: string): Promise<string | null> {
  const mc = specModelContext();
  if (mc) {
    const tool = (await mc.getTools!()).find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" is not registered on this page`);
    const json = inputArgs || "{}";
    try {
      // Spec: executeTool(tool, inputObject)
      return await mc.executeTool!(tool, JSON.parse(json));
    } catch (err: unknown) {
      // Chrome <= 153 still expects the input as a JSON string
      const e = err as { name?: string; message?: string } | null;
      if (e && (e.name === "TypeError" || /parse input/i.test(e.message ?? ""))) {
        return mc.executeTool!(tool, json);
      }
      throw err;
    }
  }
  const mct = legacyTesting();
  if (!mct) throw new Error("WebMCP is not available (document.modelContext is undefined)");
  return mct.executeTool(name, inputArgs);
}

/** List tools via document.modelContext.getTools(), or the legacy testing API. */
async function listTools(): Promise<Array<Record<string, unknown>>> {
  const mc = specModelContext();
  if (mc) {
    // RegisteredTool.window is not serialisable across the extension message channel
    return (await mc.getTools!()).map(({ name, title, description, inputSchema, origin, annotations }) => ({
      name,
      title,
      description,
      // Spec: object. Chrome 153 still returns the JSON string.
      inputSchema: typeof inputSchema === "string" ? JSON.parse(inputSchema) : inputSchema,
      origin,
      annotations,
    }));
  }
  return legacyTesting()?.listTools() ?? [];
}

// Handle EXECUTE_TOOL and LIST_TOOLS messages from the background service worker.
// These originate from the DevTools panel or popup. Web APIs such as
// document.modelContext are shared with the MAIN world, so tools the page
// registered are visible here.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "EXECUTE_TOOL") {
    executeTool(msg.name as string, msg.inputArgs as string)
      .then((result) => sendResponse({ result }))
      .catch((err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  if (msg.action === "LIST_TOOLS") {
    listTools()
      .then((tools) => sendResponse({ tools }))
      .catch(() => sendResponse({ tools: [] }));
    return true;
  }
});

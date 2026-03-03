/**
 * ISOLATED world content script — declared in manifest content_scripts.
 *
 * Receives events from the MAIN world ai-interceptor via window.postMessage
 * and forwards them to the background service worker via chrome.runtime.sendMessage.
 *
 * Also listens for WebMCP window events (toolactivated, toolcancel).
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

window.addEventListener("toolactivated", ((event: CustomEvent & { toolName?: string }) => {
  const toolName = event.toolName ?? event.detail?.toolName ?? "unknown";
  forward({
    source: "webmcp-debugger",
    type: "TOOL_ACTIVATED",
    data: { toolName, ts: Date.now() },
  });
}) as EventListener);

window.addEventListener("toolcancel", ((event: CustomEvent & { toolName?: string }) => {
  const toolName = event.toolName ?? event.detail?.toolName ?? "unknown";
  forward({
    source: "webmcp-debugger",
    type: "TOOL_CANCEL",
    data: { toolName, ts: Date.now() },
  });
}) as EventListener);

// Handle EXECUTE_TOOL and LIST_TOOLS messages from the background service worker.
// These originate from the DevTools panel or popup and need to be forwarded to
// the MAIN world via navigator.modelContextTesting.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "EXECUTE_TOOL") {
    const mct = (navigator as Record<string, unknown>).modelContextTesting as
      | { executeTool: (name: string, args: string) => Promise<string | null> }
      | undefined;
    if (!mct) {
      sendResponse({ error: "modelContextTesting not available" });
      return true;
    }
    mct
      .executeTool(msg.name as string, msg.inputArgs as string)
      .then((result) => sendResponse({ result }))
      .catch((err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  if (msg.action === "LIST_TOOLS") {
    const mct = (navigator as Record<string, unknown>).modelContextTesting as
      | { listTools: () => Array<Record<string, unknown>> }
      | undefined;
    if (!mct) {
      sendResponse({ tools: [] });
      return true;
    }
    sendResponse({ tools: mct.listTools() });
    return true;
  }
});

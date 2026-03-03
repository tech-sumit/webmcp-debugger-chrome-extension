/**
 * Background service worker.
 *
 * Receives events from bridge.ts content script, stores them in per-tab EventStore
 * (backed by chrome.storage.session), and forwards to connected DevTools panel ports.
 */

import { EventStore } from "./event-store.js";
import { TabManager } from "./tab-manager.js";

const eventStore = new EventStore();
const tabManager = new TabManager();

const TOOL_EVENT_TYPES = new Set([
  "TOOL_REGISTERED",
  "TOOL_UNREGISTERED",
  "TOOL_REGISTER_ERROR",
  "TOOL_UNREGISTER_ERROR",
  "CONTEXT_CLEARED",
]);

// Receive events from content script (bridge.ts)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.source !== "webmcp-debugger") return;
  const tabId = sender.tab?.id;
  if (!tabId) return;

  const event = { type: msg.type, ...msg.data };
  eventStore.add(tabId, event);
  tabManager.notifyPanel(tabId, { type: "EVENT", event });

  if (TOOL_EVENT_TYPES.has(msg.type)) {
    tabManager.notifyPanel(tabId, { type: "TOOLS_UPDATE", tools: eventStore.getTools(tabId) });
    updateBadge(tabId);
  }

  sendResponse({ ok: true });
});

// Panel connects via port
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "webmcp-debugger-panel") return;

  port.onMessage.addListener((msg) => {
    const tabId = msg.tabId as number | undefined;

    switch (msg.type) {
      case "GET_STATE":
        if (tabId) {
          tabManager.associateTab(port, tabId);
          // Wait for hydration so we return persisted events, not empty state
          eventStore.ready().then(() => {
            port.postMessage({
              type: "STATE",
              events: eventStore.getAll(tabId),
              tools: eventStore.getTools(tabId),
            });
          }).catch((err: unknown) => {
            console.warn("[WebMCP Debugger BG] GET_STATE failed:", err);
          });
        }
        break;

      case "EXECUTE_TOOL":
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "EXECUTE_TOOL",
            name: msg.name,
            inputArgs: msg.inputArguments,
          }).catch((err: unknown) => {
            console.warn("[WebMCP Debugger BG] EXECUTE_TOOL failed for tab", tabId, ":", err);
          });
        }
        break;

      case "CLEAR_EVENTS":
        if (tabId) {
          eventStore.clear(tabId);
          port.postMessage({ type: "STATE", events: [], tools: [] });
        }
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    tabManager.unregisterPanel(port);
  });

  tabManager.registerPanel(port);
});

// Re-inject MAIN world interceptor on navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    eventStore.add(tabId, { type: "PAGE_RELOAD", ts: Date.now() });
    tabManager.notifyPanel(tabId, { type: "PAGE_RELOAD" });
    tabManager.notifyPanel(tabId, { type: "TOOLS_UPDATE", tools: [] });
    updateBadge(tabId);

    chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        files: ["content/ai-interceptor.js"],
      })
      .catch((err: unknown) => {
        console.warn("[WebMCP Debugger BG] Failed to inject interceptor on tab", tabId, ":", err);
      });
  }
});

/** Update the extension badge with the current tool count for a specific tab. */
function updateBadge(tabId: number): void {
  const count = eventStore.getTools(tabId).length;
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
}

// Update badge when user switches tabs
chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId);
});

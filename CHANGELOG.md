# Changelog

## 1.1.0 (2026-03-04)

### Features

- **Register/unregister error events**: `ai-interceptor.ts` now wraps `registerTool()` and `unregisterTool()` in try/catch and emits `TOOL_REGISTER_ERROR` / `TOOL_UNREGISTER_ERROR` events when the browser throws `InvalidStateError`
- **`readOnlyHint` in tool metadata**: `toolMeta()` extracts `readOnlyHint` from `annotations` as a top-level field to match the spec's tool definition struct
- **`readOnlyHint` badge in Tool tab**: `EventDetail` ToolView displays a green/orange badge showing the `readOnlyHint` value when present on `TOOL_REGISTERED` events
- **Error events in panel**: `TOOL_REGISTER_ERROR` and `TOOL_UNREGISTER_ERROR` added to WebMCP category with red color coding, event name/status/payload/headers handlers, and `isEventError` detection
- **EXECUTE_TOOL / LIST_TOOLS bridge handler**: `bridge.ts` now handles `chrome.runtime.onMessage` for `EXECUTE_TOOL` and `LIST_TOOLS` actions, forwarding them to `navigator.modelContextTesting` in the page — fixes the existing gap where panel/popup messages had no content script handler

### Bug fixes

- **Background badge on errors**: `TOOL_REGISTER_ERROR` and `TOOL_UNREGISTER_ERROR` added to `TOOL_EVENT_TYPES` set so badge updates correctly on registration failures

## 1.0.0 (2026-02-17)

### Features

- **MAIN world interceptor** (`ai-interceptor.ts`): Monkey-patches `LanguageModel` (create, prompt, promptStreaming, tool execute) and `navigator.modelContext` (registerTool, unregisterTool, provideContext, clearContext) to capture all AI activity
- **ISOLATED world bridge** (`bridge.ts`): Forwards intercepted events from MAIN world to background via `chrome.runtime.sendMessage`; listens for `toolactivated` and `toolcancel` window events
- **Background service worker**: Per-tab event storage (`EventStore`), tab-aware panel management (`TabManager`), tool derivation from event history, per-tab badge updates, MAIN world re-injection on navigation
- **DevTools panel** (React): Three tabs -- Tools (discover, inspect schemas, execute with JSON editor), Timeline (chronological event log with type filtering), AI Sessions (LanguageModel session threads)
- **InspectorContext**: React context with reducer for state management, background port communication, `sendMessage` API for components
- **Manifest V3**: DevTools page, content scripts (MAIN + ISOLATED), background service worker, popup

### Bug fixes

- **Streaming accumulation**: Fixed `fullText += value` (was `= value`) in `promptStreaming` handler to correctly accumulate all streamed chunks
- **Tool execute binding**: Fixed `tool.execute.bind(tool)` to preserve `this` context for tool execution callbacks
- **Unhandled rejections**: Added `.catch()` to `chrome.tabs.sendMessage()` for closed tabs / missing content scripts
- **Event emission ordering**: All interceptors (`registerTool`, `unregisterTool`, `provideContext`, `clearContext`) now emit events AFTER calling the original function to avoid false positives when the browser throws (e.g., duplicate name, invalid schema, atomic rollback on provideContext)
- **provideContext semantics**: Emit `CONTEXT_CLEARED` before `TOOL_REGISTERED` events to match WebIDL spec (provideContext replaces the entire tool set)
- **Real-time tool updates**: Background sends `TOOLS_UPDATE` to panel on tool-related events (TOOL_REGISTERED, TOOL_UNREGISTERED, CONTEXT_CLEARED) so `state.tools` stays in sync without manual refresh
- **PAGE_RELOAD handling**: Reducer clears `state.tools` on PAGE_RELOAD; background sends `TOOLS_UPDATE` with empty tools and updates badge
- **Tab-aware notifications**: TabManager tracks port-to-tabId associations so each panel only receives events for its inspected tab
- **Per-tab badge**: `chrome.action.setBadgeText` now includes `tabId` for per-tab tool count display
- **Badge accuracy**: Uses `deriveToolsFromEvents()` instead of naive `TOOL_REGISTERED` event count to correctly account for unregistrations, context clears, and page reloads
- **Tool list sync on clear**: ToolsTab `useEffect` syncs `state.tools` unconditionally (removed `length > 0` guard) so UI correctly shows empty state when tools are cleared
- **Panel disconnect state**: Dispatches `SET_CONNECTED: false` on port cleanup so StatusBar shows correct connection status
- **Tool execution async**: ToolsTab `handleExecute` uses temp global + polling to work around `inspectedWindow.eval()` not supporting promise results from `executeTool()`
- **CLEAR_EVENTS sync**: TimelineTab Clear button sends message to background via port (not just local dispatch) so EventStore is also cleared
- **CLEAR_EVENTS response**: Background responds with empty STATE after clearing to ensure panel-background consistency

# WebMCP Debugger Chrome Extension

Chrome DevTools extension for introspecting `window.ai` (Prompt API / Gemini Nano) and `document.modelContext` (WebMCP) on any web page.

## Features

- **Tools Tab**: List all registered WebMCP tools, view schemas, execute manually with a JSON editor
- **Timeline Tab**: Chronological log of all AI events (tool registrations, prompts, tool calls) with filtering
- **AI Sessions Tab**: View LanguageModel sessions, prompt/response threads, streaming visualization

## Requirements

- Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled (or a page enrolled in the WebMCP origin trial). Older builds that only expose `navigator.modelContext` are still supported
- For window.ai features: `chrome://flags/#optimization-guide-on-device-model` enabled

## Installation

1. `pnpm install && pnpm build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` directory

## Development

```bash
pnpm install
pnpm build         # Build all (pages + content scripts + background)
pnpm typecheck     # TypeScript check
pnpm lint          # ESLint
pnpm package       # Create ZIP for distribution
```

## Architecture

```
ai-interceptor.ts (MAIN world)
    │  monkey-patches LanguageModel + modelContext
    │  posts events via window.postMessage
    ▼
bridge.ts (ISOLATED world)
    │  receives postMessage events
    │  forwards via chrome.runtime.sendMessage
    ▼
background/index.ts (Service Worker)
    │  stores events in EventStore
    │  forwards to connected panels via port
    ▼
panel/src/App.tsx (DevTools Panel)
    │  React app with 3 tabs
    │  connected via chrome.runtime.connect port
```

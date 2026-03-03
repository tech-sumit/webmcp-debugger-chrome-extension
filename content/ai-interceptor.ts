/**
 * MAIN world content script — injected via chrome.scripting.executeScript({ world: 'MAIN' }).
 *
 * Monkey-patches LanguageModel (window.ai) and navigator.modelContext to intercept
 * all AI activity. Posts events to the ISOLATED world bridge via window.postMessage.
 */

export {};

/* ── Shared helpers ──────────────────────────────────────────── */

function emit(type: string, data: Record<string, unknown>) {
  window.postMessage({ source: "webmcp-debugger", type, data }, "*");
}

/** Wrap a tool's execute callback to emit TOOL_CALL / TOOL_RESULT_AI events. */
function wrapToolExecute(
  toolDef: Record<string, unknown>,
  sessionId?: string,
): Record<string, unknown> {
  if (typeof toolDef.execute !== "function") return toolDef;
  const origExecute = toolDef.execute as (args: unknown) => unknown;
  const wrapped = { ...toolDef };
  wrapped.execute = async function (args: unknown) {
    const base = sessionId ? { sessionId, tool: toolDef.name } : { tool: toolDef.name };
    emit("TOOL_CALL", { ...base, args, ts: Date.now() });
    try {
      const result = await origExecute(args);
      emit("TOOL_RESULT_AI", { ...base, result, ts: Date.now() });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit("TOOL_RESULT_AI", { ...base, error: message, ts: Date.now() });
      throw err;
    }
  };
  return wrapped;
}

/** Extract the serialisable subset of a tool definition for TOOL_REGISTERED events. */
function toolMeta(toolDef: Record<string, unknown>) {
  const annotations = toolDef.annotations as Record<string, unknown> | undefined;
  return {
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    annotations: toolDef.annotations,
    readOnlyHint: annotations?.readOnlyHint === true ? true : undefined,
  };
}

/* ── LanguageModel (window.ai) interception ──────────────────── */

(function interceptLanguageModel() {
  // @ts-expect-error LanguageModel is an experimental Chrome API
  const LM = globalThis.LanguageModel;
  if (!LM?.create) return;

  const originalCreate = LM.create.bind(LM);
  LM.create = async function (options: Record<string, unknown>) {
    const session = await originalCreate(options);
    const sessionId = crypto.randomUUID();

    // Wrap prompt()
    if (typeof session.prompt === "function") {
      const originalPrompt = session.prompt.bind(session);
      session.prompt = async function (input: unknown, opts?: unknown) {
        emit("PROMPT_SENT", { sessionId, input, opts, ts: Date.now() });
        try {
          const result = await originalPrompt(input, opts);
          emit("PROMPT_RESPONSE", { sessionId, result, ts: Date.now() });
          return result;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          emit("PROMPT_ERROR", { sessionId, error: message, ts: Date.now() });
          throw err;
        }
      };
    }

    // Wrap promptStreaming()
    if (typeof session.promptStreaming === "function") {
      const originalStream = session.promptStreaming.bind(session);
      session.promptStreaming = function (input: unknown, opts?: unknown) {
        emit("STREAM_START", { sessionId, input, opts, ts: Date.now() });
        const stream = originalStream(input, opts);
        return new ReadableStream({
          async start(controller: ReadableStreamDefaultController) {
            const reader = stream.getReader();
            let fullText = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                fullText += value;
                controller.enqueue(value);
              }
              emit("STREAM_END", { sessionId, result: fullText, ts: Date.now() });
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
        });
      };
    }

    // Wrap tool execute callbacks (reuses shared helper with sessionId)
    if (Array.isArray(options?.tools)) {
      for (const tool of options.tools as Record<string, unknown>[]) {
        Object.assign(tool, wrapToolExecute(tool, sessionId));
      }
    }

    emit("SESSION_CREATED", {
      sessionId,
      options: {
        temperature: options?.temperature,
        topK: options?.topK,
        tools: Array.isArray(options?.tools)
          ? (options.tools as Record<string, unknown>[]).map((t) => t.name)
          : undefined,
      },
      quotaUsage: {
        inputUsed: session.inputUsed,
        inputQuota: session.inputQuota,
      },
      ts: Date.now(),
    });

    return session;
  };
})();

/* ── navigator.modelContext (WebMCP) interception ────────────── */

(function interceptModelContext() {
  const mc = navigator.modelContext;
  if (!mc) return;

  const origRegister = mc.registerTool.bind(mc);
  mc.registerTool = function (toolDef: Record<string, unknown>) {
    try {
      const result = origRegister(wrapToolExecute(toolDef));
      emit("TOOL_REGISTERED", { tool: toolMeta(toolDef), ts: Date.now() });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit("TOOL_REGISTER_ERROR", { name: toolDef.name, error: message, ts: Date.now() });
      throw err;
    }
  };

  if (typeof mc.unregisterTool === "function") {
    const origUnregister = mc.unregisterTool.bind(mc);
    mc.unregisterTool = function (name: string) {
      try {
        const result = origUnregister(name);
        emit("TOOL_UNREGISTERED", { name, ts: Date.now() });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        emit("TOOL_UNREGISTER_ERROR", { name, error: message, ts: Date.now() });
        throw err;
      }
    };
  }

  if (typeof mc.provideContext === "function") {
    const origProvideContext = mc.provideContext.bind(mc);
    mc.provideContext = function (params: { tools: Array<Record<string, unknown>> }) {
      const wrappedParams = {
        ...params,
        tools: Array.isArray(params?.tools) ? params.tools.map((t) => wrapToolExecute(t)) : params?.tools,
      };
      const result = origProvideContext(wrappedParams);
      emit("CONTEXT_CLEARED", { ts: Date.now() });
      if (Array.isArray(params?.tools)) {
        for (const toolDef of params.tools) {
          emit("TOOL_REGISTERED", { tool: toolMeta(toolDef), ts: Date.now() });
        }
      }
      return result;
    };
  }

  if (typeof mc.clearContext === "function") {
    const origClearContext = mc.clearContext.bind(mc);
    mc.clearContext = function () {
      const result = origClearContext();
      emit("CONTEXT_CLEARED", { ts: Date.now() });
      return result;
    };
  }
})();

declare global {
  interface Navigator {
    modelContext?: {
      registerTool: (tool: Record<string, unknown>) => void;
      unregisterTool: (name: string) => void;
      provideContext: (params: { tools: Array<Record<string, unknown>> }) => void;
      clearContext: () => void;
    };
  }
}

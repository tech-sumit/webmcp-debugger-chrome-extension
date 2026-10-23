/**
 * MAIN world content script — injected via chrome.scripting.executeScript({ world: 'MAIN' }).
 *
 * Monkey-patches LanguageModel (window.ai) and the WebMCP ModelContext
 * (document.modelContext, or the legacy navigator.modelContext) to intercept
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
  const origExecute = toolDef.execute as (args: unknown, options?: unknown) => unknown;
  const wrapped = { ...toolDef };
  // Per spec the callback receives (inputObject, { signal }); pass both through.
  wrapped.execute = async function (args: unknown, options?: unknown) {
    const base = sessionId ? { sessionId, tool: toolDef.name } : { tool: toolDef.name };
    emit("TOOL_CALL", { ...base, args, ts: Date.now() });
    try {
      const result = await origExecute(args, options);
      emit("TOOL_RESULT_AI", { ...base, result, ts: Date.now() });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Spec: the execution signal aborts when the agent cancels the call
      const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
      emit("TOOL_RESULT_AI", {
        ...base,
        error: signal?.aborted ? `Cancelled by agent: ${message}` : message,
        ...(signal?.aborted && { cancelled: true }),
        ts: Date.now(),
      });
      throw err;
    }
  };
  return wrapped;
}

/** Spec `ToolAnnotations` with defaults applied (all hints default to false). */
function normalizeAnnotations(annotations: unknown) {
  if (annotations == null || typeof annotations !== "object") return undefined;
  const a = annotations as Record<string, unknown>;
  return {
    readOnlyHint: a.readOnlyHint === true,
    untrustedContentHint: a.untrustedContentHint === true,
    consequentialHint: a.consequentialHint === true,
    debugging: a.debugging === true,
  };
}

/** Extract the serialisable subset of a tool definition for TOOL_REGISTERED events. */
function toolMeta(toolDef: Record<string, unknown>, options?: Record<string, unknown>) {
  const annotations = normalizeAnnotations(toolDef.annotations);
  const exposedTo = Array.isArray(options?.exposedTo) ? options.exposedTo.map(String) : undefined;
  return {
    name: toolDef.name,
    title: toolDef.title,
    description: toolDef.description,
    inputSchema: toolDef.inputSchema,
    annotations,
    readOnlyHint: annotations?.readOnlyHint === true ? true : undefined,
    ...(exposedTo && exposedTo.length > 0 && { exposedTo }),
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

/* ── document.modelContext (WebMCP) interception ─────────────── */

(function interceptModelContext() {
  // Spec: document.modelContext (Chrome 149+). Legacy: navigator.modelContext (Chrome <= 151).
  const mc = document.modelContext ?? navigator.modelContext;
  if (!mc) return;

  const origRegister = mc.registerTool.bind(mc);
  mc.registerTool = function (
    toolDef: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    const signal = options?.signal as AbortSignal | undefined;
    let registered = false;
    const onRegistered = () => {
      if (signal?.aborted) return;
      registered = true;
      emit("TOOL_REGISTERED", { tool: toolMeta(toolDef, options), ts: Date.now() });
    };
    const onError = (err: unknown) => {
      // Aborting the signal before the promise settles unregisters the tool;
      // that is not a registration failure.
      if (signal?.aborted && err === signal.reason) return;
      const message = err instanceof Error ? err.message : String(err);
      emit("TOOL_REGISTER_ERROR", { name: toolDef.name, error: message, ts: Date.now() });
    };

    // Spec: aborting the registration signal unregisters the tool.
    signal?.addEventListener(
      "abort",
      () => {
        if (registered) emit("TOOL_UNREGISTERED", { name: toolDef.name, reason: "signal", ts: Date.now() });
      },
      { once: true },
    );

    let result: Promise<void> | void;
    try {
      result = options === undefined
        ? origRegister(wrapToolExecute(toolDef))
        : origRegister(wrapToolExecute(toolDef), options);
    } catch (err: unknown) {
      // Legacy implementations threw synchronously
      onError(err);
      throw err;
    }

    if (result instanceof Promise) {
      // Spec: registerTool() returns a promise that rejects on invalid input
      return result.then(
        () => {
          onRegistered();
        },
        (err: unknown) => {
          onError(err);
          throw err;
        },
      );
    }
    onRegistered();
    return result;
  };

  /* Legacy APIs removed from the spec; still patched for older Chrome builds. */

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

interface InterceptedModelContext {
  registerTool: (tool: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void> | void;
  /** Removed from the spec; present on older Chrome builds. */
  unregisterTool?: (name: string) => void;
  /** Removed from the spec; present on older Chrome builds. */
  provideContext?: (params: { tools: Array<Record<string, unknown>> }) => void;
  /** Removed from the spec; present on older Chrome builds. */
  clearContext?: () => void;
}

declare global {
  interface Document {
    modelContext?: InterceptedModelContext;
  }
  interface Navigator {
    /** Legacy location (Chrome <= 151). */
    modelContext?: InterceptedModelContext;
  }
}

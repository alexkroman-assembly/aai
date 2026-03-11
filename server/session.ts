import type { PlatformConfig } from "./config.ts";
import { callLLM, type CallLLMOptions } from "./llm.ts";
import type { ExecuteTool } from "@aai/core/worker-entry";
import { connectStt, type SttEvents, type SttHandle } from "./stt.ts";
import { createTtsClient } from "./tts.ts";
import { executeBuiltinTool } from "./builtin_tools.ts";
import { executeTurn, type TurnCallLLMOptions } from "./turn_handler.ts";
import type { ChatMessage, LLMResponse, STTConfig } from "./types.ts";
import type { AgentConfig, ToolSchema } from "@aai/sdk/types";
import type { WorkerApi } from "@aai/core/worker-entry";
import { buildSystemPrompt } from "./system_prompt.ts";
import * as metrics from "./metrics.ts";
import { AUDIO_FORMAT, PROTOCOL_VERSION } from "@aai/core/protocol";

export type SessionTransport = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
};

export type TtsClient = {
  synthesizeStream(
    chunks: string | AsyncIterable<string>,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): void;
};

export const _internals = {
  connectStt: connectStt as (
    apiKey: string,
    config: STTConfig,
    events: SttEvents,
  ) => Promise<SttHandle>,
  callLLM: callLLM as (opts: CallLLMOptions) => Promise<LLMResponse>,
  createTtsClient: createTtsClient as (
    config: Parameters<typeof createTtsClient>[0],
  ) => TtsClient,
  executeBuiltinTool: executeBuiltinTool as (
    name: string,
    args: Record<string, unknown>,
    env?: Record<string, string | undefined>,
  ) => Promise<string | null>,
};

export type SessionOptions = {
  id: string;
  agent: string;
  transport: SessionTransport;
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  env?: Record<string, string | undefined>;
  getWorkerApi?: () => Promise<WorkerApi>;
  skipGreeting?: boolean;
};

export type Session = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(data: Uint8Array): void;
  onAudioReady(): void;
  onCancel(): void;
  onReset(): void;
  onHistory(messages: { role: "user" | "assistant"; text: string }[]): void;
  waitForTurn(): Promise<void>;
};

export function createSession(opts: SessionOptions): Session {
  const {
    id,
    agent,
    transport: ws,
    toolSchemas,
    platformConfig,
    executeTool,
    getWorkerApi,
  } = opts;
  const agentLabel = { agent };

  const slotEnv = opts.env as Record<string, string> | undefined;
  let cachedWorkerApi: WorkerApi | undefined;
  async function invokeHook(
    hook: string,
    extra?: { text?: string; error?: string },
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      await cachedWorkerApi.invokeHook(hook, id, extra, 5_000, slotEnv);
    } catch (err: unknown) {
      console.error(`${hook} hook failed`, { err });
    }
  }

  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  const env: Record<string, string | undefined> = { ...opts.env };
  const config: PlatformConfig = {
    ...platformConfig,
    sttConfig: {
      ...platformConfig.sttConfig,
      ...(agentConfig.prompt ? { prompt: agentConfig.prompt } : {}),
    },
    ttsConfig: {
      ...platformConfig.ttsConfig,
      ...(agentConfig.voice ? { voice: agentConfig.voice } : {}),
    },
  };

  const doConnectStt = _internals.connectStt;
  const doCallLLM = _internals.callLLM;
  const tts: TtsClient = _internals.createTtsClient(config.ttsConfig);
  const doExecuteBuiltinTool = _internals.executeBuiltinTool;

  let stt: SttHandle | null = null;
  const sessionAbort = new AbortController();
  let turnAbort: AbortController | null = null;
  let turnPromise: Promise<void> | null = null;
  let audioFrameCount = 0;
  let pendingGreeting: string | null = null;
  let messages: ChatMessage[] = [{
    role: "system",
    content: buildSystemPrompt(agentConfig, toolSchemas, { voice: true }),
  }];

  function boundCallLLM(turnOpts: TurnCallLLMOptions): Promise<LLMResponse> {
    return doCallLLM({
      ...turnOpts,
      apiKey: config.apiKey,
      model: config.model,
      gatewayBase: config.llmGatewayBase,
    });
  }

  async function boundExecuteTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const builtin = await doExecuteBuiltinTool(name, args, env);
    return builtin ?? await executeTool(name, args, id);
  }

  function trySend(data: string | Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch { /* ws closed between check and send */ }
  }

  function trySendJson(data: Record<string, unknown>): void {
    trySend(JSON.stringify(data));
  }

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function doConnectSttWithEvents(): Promise<void> {
    const events: SttEvents = {
      onTranscript: (text, isFinal, turnOrder) => {
        console.info("transcript", { text, isFinal, turnOrder });
        if (isFinal) {
          trySendJson({
            type: "final_transcript",
            text,
            ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
          });
        } else {
          trySendJson({ type: "partial_transcript", text });
        }
      },
      onTurn: (text, turnOrder) => {
        console.info("turn", { text, turnOrder });
        const prev = turnPromise;
        const next = (prev ?? Promise.resolve())
          .catch(() => {})
          .then(() => handleTurn(text, turnOrder))
          .finally(() => {
            if (turnPromise === next) turnPromise = null;
          });
        turnPromise = next;
      },
      onTermination: (audioDuration, sessionDuration) => {
        console.info("STT termination", { audioDuration, sessionDuration });
      },
      onError: (err) => {
        console.error("STT error:", err.message);
        trySendJson({
          type: "error",
          message: err.message,
        });
      },
      onClose: () => {
        console.info("STT closed");
        stt = null;
        if (!sessionAbort.signal.aborted) {
          console.info("Attempting STT reconnect");
          doConnectSttWithEvents().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("STT reconnect failed:", msg);
            trySendJson({ type: "error", message: msg });
          });
        }
      },
    };

    try {
      stt = await doConnectStt(config.apiKey, config.sttConfig, events);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("STT connect failed:", msg);
      trySendJson({ type: "error", message: msg });
    }
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    cancelInflight();
    metrics.turnsTotal.inc(agentLabel);
    const turnStart = performance.now();

    trySendJson({
      type: "turn",
      text,
      ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
    });

    invokeHook("onTurn", { text });

    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);

    try {
      const result = await executeTurn(text, {
        agent,
        messages,
        toolSchemas,
        callLLM: boundCallLLM,
        executeTool: boundExecuteTool,
        signal,
      });
      if (signal.aborted) return;

      if (result) {
        trySendJson({ type: "chat", text: result });
        await tts.synthesizeStream(
          result,
          (chunk) => trySend(chunk),
          signal,
        );
        if (!signal.aborted) trySendJson({ type: "tts_done" });
      } else {
        trySendJson({ type: "tts_done" });
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Turn failed:", msg);
      metrics.errorsTotal.inc({ ...agentLabel, component: "turn" });
      trySendJson({ type: "error", message: msg });
    } finally {
      if (turnAbort === abort) turnAbort = null;
      metrics.turnDuration.observe(
        (performance.now() - turnStart) / 1000,
        agentLabel,
      );
    }
  }

  function speakText(text: string): void {
    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);
    const p = tts
      .synthesizeStream(text, (chunk) => trySend(chunk), signal)
      .then(() => {
        if (!signal.aborted) trySendJson({ type: "tts_done" });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("TTS failed:", msg);
        trySendJson({ type: "error", message: msg });
      })
      .finally(() => {
        if (turnAbort === abort) turnAbort = null;
        if (turnPromise === p) turnPromise = null;
      });
    turnPromise = p;
  }

  return {
    async start(): Promise<void> {
      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      if (agentConfig.greeting) pendingGreeting = agentConfig.greeting;

      invokeHook("onConnect");

      await doConnectSttWithEvents();
      trySendJson({
        type: "ready",
        protocol_version: PROTOCOL_VERSION,
        audio_format: AUDIO_FORMAT,
        sample_rate: config.sttConfig.sampleRate,
        tts_sample_rate: config.ttsConfig.sampleRate,
      });
    },

    async stop(): Promise<void> {
      if (sessionAbort.signal.aborted) return;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);
      const pending = turnPromise;
      if (pending) await pending;
      stt?.close();
      tts.close();

      invokeHook("onDisconnect");
    },

    onAudio(data: Uint8Array): void {
      audioFrameCount++;
      if (audioFrameCount <= 3) {
        console.debug("audio frame", {
          frame: audioFrameCount,
          bytes: data.length,
        });
      }
      stt?.send(data);
    },

    onAudioReady(): void {
      if (pendingGreeting) {
        trySendJson({ type: "chat", text: pendingGreeting });
        speakText(pendingGreeting);
        pendingGreeting = null;
      }
    },

    onCancel(): void {
      cancelInflight();
      stt?.clear();
      trySendJson({ type: "cancelled" });
    },

    onReset(): void {
      cancelInflight();
      stt?.clear();
      messages = messages.slice(0, 1);
      trySendJson({ type: "reset" });

      if (agentConfig.greeting) {
        trySendJson({ type: "chat", text: agentConfig.greeting });
        speakText(agentConfig.greeting);
      }
    },

    onHistory(
      incoming: { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        messages.push({ role: msg.role, content: msg.text });
      }
      console.info("Restored conversation history", {
        count: incoming.length,
      });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

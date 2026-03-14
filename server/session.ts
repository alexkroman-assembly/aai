// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import type { PlatformConfig } from "./config.ts";
import { createModel } from "./model.ts";
import type { ExecuteTool } from "./_worker_entry.ts";
import { createSttConnection, type SttConnection } from "./stt.ts";
import { createTtsConnection, type TtsConnection } from "./tts.ts";
import { getBuiltinVercelTools } from "./builtin_tools.ts";
import { executeTurn } from "./turn_handler.ts";
import type { STTConfig, TTSConfig } from "./types.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/types";
import type { WorkerApi } from "./_worker_entry.ts";
import { buildSystemPrompt } from "./system_prompt.ts";
import {
  type CoreAssistantMessage,
  type CoreMessage,
  type CoreUserMessage,
  jsonSchema,
  type StepResult,
  tool as vercelTool,
  type ToolExecutionOptions,
  type ToolSet,
} from "ai";
import type { Message } from "@aai/sdk/types";
import * as metrics from "./metrics.ts";
import { AUDIO_FORMAT, PROTOCOL_VERSION } from "@aai/sdk/protocol";

/**
 * Typed interface for pushing session events to a connected client.
 *
 * For WebSocket sessions this is backed by a capnweb RPC stub;
 * for Twilio it's a custom implementation that converts audio formats.
 */
export interface ClientSink {
  /** Whether the underlying connection is open and accepting calls. */
  readonly open: boolean;
  /** Notify the client that the session is ready with negotiated config. */
  ready(config: {
    protocol_version: number;
    audio_format: string;
    sample_rate: number;
    tts_sample_rate: number;
    mode?: string;
  }): void;
  /** Send a partial (in-progress) STT transcript. */
  partialTranscript(text: string): void;
  /** Send a finalized STT transcript. */
  finalTranscript(text: string, turnOrder?: number): void;
  /** Notify the client that a user turn was committed. */
  turn(text: string, turnOrder?: number): void;
  /** Send an assistant chat message. */
  chat(text: string): void;
  /** Signal that TTS playback is complete. */
  ttsDone(): void;
  /** Signal that the current turn was cancelled. */
  cancelled(): void;
  /** Signal that the session was reset. */
  resetNotify(): void;
  /** Report an error to the client. */
  error(message: string): void;
  /** Stream TTS audio to the client as a ReadableStream. */
  playAudioStream(stream: ReadableStream<Uint8Array>): void;
}

/** Configuration options for creating a new session. */
export type SessionOptions = {
  /** Unique session identifier. */
  id: string;
  /** Agent slug this session belongs to. */
  agent: string;
  /** Typed sink for pushing events to the client. */
  client: ClientSink;
  /** The agent's configuration from `defineAgent()`. */
  agentConfig: AgentConfig;
  /** JSON schemas for agent-defined tools. */
  toolSchemas: readonly ToolSchema[];
  /** Platform-level configuration (API keys, model, STT/TTS settings). */
  platformConfig: PlatformConfig;
  /** Function to execute a tool call in the agent worker. */
  executeTool: ExecuteTool;
  /** Environment variables available to the agent. */
  env?: Record<string, string | undefined>;
  /** Factory to lazily obtain the worker API (spawns worker on first call). */
  getWorkerApi?: () => Promise<WorkerApi>;
  /** When true, suppresses the initial greeting (used for resumed sessions). */
  skipGreeting?: boolean;
  /** Override the default STT connection factory (used in tests). */
  createStt?: (apiKey: string, config: STTConfig) => SttConnection;
  /** Override the default TTS connection factory (used in tests). */
  createTts?: (config: TTSConfig) => TtsConnection;
};

const ConnState = {
  Idle: "Idle",
  Starting: "Starting",
  Ready: "Ready",
  Stopped: "Stopped",
} as const;
type ConnState = (typeof ConnState)[keyof typeof ConnState];

const AgentState = {
  WaitingForAudio: "WaitingForAudio",
  Listening: "Listening",
  Processing: "Processing",
} as const;
type AgentState = (typeof AgentState)[keyof typeof AgentState];

/** A voice session managing the STT -> LLM -> TTS pipeline for one connection. */
export type Session = {
  /** Initializes the session, connects to STT, and sends the ready message. */
  start(): Promise<void>;
  /** Gracefully stops the session, aborting any in-flight turn and closing STT/TTS. */
  stop(): Promise<void>;
  /** Feeds raw PCM audio data from the client into the STT stream. */
  onAudio(data: Uint8Array): void;
  /** Signals that the client's audio pipeline is ready (triggers pending greeting). */
  onAudioReady(): void;
  /** Cancels the current in-flight turn and clears the STT buffer. */
  onCancel(): void;
  /** Resets the conversation history and replays the greeting if configured. */
  onReset(): void;
  /** Restores prior conversation history for a resumed session. */
  onHistory(
    incoming: readonly { role: "user" | "assistant"; text: string }[],
  ): void;
  /** Returns a promise that resolves when the current turn completes. */
  waitForTurn(): Promise<void>;
};

/**
 * Creates a new voice session that wires STT, LLM, and TTS together.
 *
 * The session manages the full lifecycle: connecting to STT, processing
 * user speech into turns, running the agentic LLM loop, synthesizing
 * the response via TTS, and streaming audio back to the client.
 *
 * @param opts - Session configuration including transport, agent config, and tool schemas.
 * @returns A {@linkcode Session} object for controlling the session lifecycle.
 */
export function createSession(opts: SessionOptions): Session {
  let conn: ConnState = ConnState.Idle;
  let agent: AgentState = AgentState.WaitingForAudio;

  let stt: SttConnection | null = null;
  let turnAbort: AbortController | null = null;
  let turnPromise: Promise<void> | null = null;
  let audioFrameCount = 0;
  let pendingGreeting: string | null = null;
  let messages: CoreMessage[] = [];
  let cachedWorkerApi: WorkerApi | undefined;

  const sessionAbort = new AbortController();

  const id = opts.id;
  const agentSlug = opts.agent;
  const client = opts.client;
  const agentLabel = { agent: opts.agent };
  const env = { ...opts.env };
  const getWorkerApi = opts.getWorkerApi;
  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  const config: PlatformConfig = {
    ...opts.platformConfig,
    sttConfig: {
      ...opts.platformConfig.sttConfig,
      ...(agentConfig.sttPrompt ? { sttPrompt: agentConfig.sttPrompt } : {}),
    },
    ttsConfig: {
      ...opts.platformConfig.ttsConfig,
      ...(agentConfig.voice ? { voice: agentConfig.voice } : {}),
    },
  };

  const isSttOnly = agentConfig.mode === "stt-only";
  const doCreateStt = opts.createStt ?? createSttConnection;

  const tts = isSttOnly
    ? null
    : (opts.createTts ?? createTtsConnection)(config.ttsConfig);
  tts?.warmup();

  const model = isSttOnly ? null : createModel({
    apiKey: config.apiKey,
    model: config.model,
    gatewayBase: config.llmGatewayBase,
  });

  const hasTools = opts.toolSchemas.length > 0 ||
    (agentConfig.builtinTools?.length ?? 0) > 0;
  const systemPrompt = isSttOnly
    ? ""
    : buildSystemPrompt(agentConfig, { hasTools, voice: true });

  let tools: ToolSet;
  if (isSttOnly) {
    tools = {};
  } else {
    tools = getBuiltinVercelTools(agentConfig.builtinTools ?? [], env);
    for (const schema of opts.toolSchemas) {
      tools[schema.name] = vercelTool({
        description: schema.description,
        parameters: jsonSchema(schema.parameters),
        execute: async (args: unknown, _options: ToolExecutionOptions) => {
          const msgs: Message[] = [];
          for (const m of messages) {
            if (
              typeof m.content === "string" &&
              (m.role === "user" || m.role === "assistant")
            ) {
              msgs.push({ role: m.role, content: m.content });
            }
          }
          return await opts.executeTool(
            schema.name,
            args as Record<string, unknown>,
            id,
            msgs,
          );
        },
      });
    }
  }

  /** Safely call a method on the client sink, ignoring errors if closed. */
  function trySend(fn: () => void): void {
    try {
      if (client.open) fn();
    } catch { /* connection closed between check and send */ }
  }

  async function callHook(
    name: string,
    fn: (api: WorkerApi) => Promise<void>,
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      await fn(cachedWorkerApi);
    } catch (err: unknown) {
      log.error(`${name} hook failed`, { err });
    }
  }

  async function connectStt(): Promise<void> {
    try {
      const handle = doCreateStt(config.apiKey, config.sttConfig);
      await handle.connect();

      handle.onTranscript = ({ text, isFinal, turnOrder }) => {
        log.info("transcript", { text, isFinal, turnOrder });
        if (isFinal) {
          trySend(() => client.finalTranscript(text, turnOrder));
        } else {
          trySend(() => client.partialTranscript(text));
        }
      };

      handle.onTurn = ({ text, turnOrder }) => {
        log.info("turn", { text, turnOrder });
        const prev = turnPromise;
        const next: Promise<void> = (async () => {
          try {
            await prev;
          } catch (e) {
            log.warn("previous turn failed", e);
          }
          await handleTurn(text, turnOrder);
        })().finally(() => {
          if (turnPromise === next) turnPromise = null;
        });
        turnPromise = next;
      };

      handle.onError = (err) => {
        log.error("STT error:", err.message);
        trySend(() => client.error(err.message));
      };

      handle.onClose = async () => {
        log.info("STT closed");
        stt = null;
        if (!sessionAbort.signal.aborted) {
          log.info("Attempting STT reconnect");
          try {
            await connectStt();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("STT reconnect failed:", msg);
            trySend(() => client.error(msg));
          }
        }
      };

      stt = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("STT connect failed:", msg);
      trySend(() => client.error(msg));
    }
  }

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    cancelInflight();
    agent = AgentState.Processing;

    metrics.turnsTotal.inc(agentLabel);
    const turnStart = performance.now();

    trySend(() => client.turn(text, turnOrder));

    callHook("onTurn", (api) => api.onTurn(id, text, 5_000));

    if (isSttOnly) {
      trySend(() => client.ttsDone());
      metrics.turnDuration.observe(
        (performance.now() - turnStart) / 1000,
        agentLabel,
      );
      agent = AgentState.Listening;
      return;
    }

    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);

    try {
      let maxSteps = agentConfig.maxSteps;
      if (maxSteps === undefined && getWorkerApi) {
        try {
          cachedWorkerApi ??= await getWorkerApi();
          const resolved = await cachedWorkerApi.resolveMaxSteps(
            id,
            5_000,
          );
          if (resolved !== null) maxSteps = resolved;
        } catch (err: unknown) {
          log.warn("resolveMaxSteps failed, using default", { err });
        }
      }

      const result = await executeTurn(text, {
        agent: agentSlug,
        model: model!,
        system: systemPrompt,
        messages,
        tools,
        signal,
        maxSteps,
        toolChoice: agentConfig.toolChoice,
        onStep: getWorkerApi
          ? async (step: StepResult<ToolSet>) => {
            const stepInfo = {
              stepNumber: step.stepType === "initial" ? 0 : -1,
              toolCalls: (step.toolCalls ?? []).map((tc) => ({
                toolName: tc.toolName,
                args: tc.args as Record<string, unknown>,
              })),
              text: step.text ?? "",
            };
            await callHook("onStep", (api) =>
              api.onStep(id, stepInfo, 5_000));
          }
          : undefined,
        resolveBeforeStep: getWorkerApi
          ? async (stepNumber: number) => {
            try {
              cachedWorkerApi ??= await getWorkerApi!();
              return await cachedWorkerApi.resolveBeforeStep(
                id,
                stepNumber,
                5_000,
              );
            } catch (err: unknown) {
              log.warn("resolveBeforeStep failed", { err });
              return null;
            }
          }
          : undefined,
      });
      if (signal.aborted) return;

      if (result) {
        trySend(() => client.chat(result));
        // Wrap TTS callback-based output as a ReadableStream
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const audioStream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        trySend(() => client.playAudioStream(audioStream));
        await tts!.synthesizeStream(
          result,
          (chunk) => {
            try {
              controller.enqueue(chunk);
            } catch { /* stream may be closed */ }
          },
          signal,
        );
        try {
          controller!.close();
        } catch { /* already closed */ }
        if (!signal.aborted) trySend(() => client.ttsDone());
      } else {
        trySend(() => client.ttsDone());
      }
    } catch (err: unknown) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error &&
        "responseBody" in err
      ) {
        const { responseBody, statusCode } = err as Error & {
          responseBody?: unknown;
          statusCode?: number;
        };
        log.error("Turn failed:", msg, { responseBody, statusCode });
      } else {
        log.error("Turn failed:", msg);
      }
      metrics.errorsTotal.inc({ ...agentLabel, component: "turn" });
      trySend(() => client.error(msg));
    } finally {
      if (turnAbort === abort) turnAbort = null;
      metrics.turnDuration.observe(
        (performance.now() - turnStart) / 1000,
        agentLabel,
      );
      if (agent === AgentState.Processing) {
        agent = AgentState.Listening;
      }
    }
  }

  function speakText(text: string): void {
    if (!tts) return;
    const abort = new AbortController();
    turnAbort = abort;
    const signal = AbortSignal.any([sessionAbort.signal, abort.signal]);
    const p: Promise<void> = (async () => {
      try {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const audioStream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        trySend(() => client.playAudioStream(audioStream));
        await tts.synthesizeStream(
          text,
          (chunk) => {
            try {
              controller.enqueue(chunk);
            } catch { /* stream may be closed */ }
          },
          signal,
        );
        try {
          controller!.close();
        } catch { /* already closed */ }
        if (!signal.aborted) trySend(() => client.ttsDone());
      } catch (err: unknown) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        log.error("TTS failed:", msg);
        trySend(() => client.error(msg));
      } finally {
        if (turnAbort === abort) turnAbort = null;
      }
    })().finally(() => {
      if (turnPromise === p) turnPromise = null;
    });
    turnPromise = p;
  }

  return {
    async start(): Promise<void> {
      if (conn !== ConnState.Idle) return;
      conn = ConnState.Starting;

      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      if (agentConfig.greeting) {
        pendingGreeting = agentConfig.greeting;
      }

      callHook("onConnect", (api) => api.onConnect(id, 5_000));
      await connectStt();

      conn = ConnState.Ready;
      trySend(() =>
        client.ready({
          protocol_version: PROTOCOL_VERSION,
          audio_format: AUDIO_FORMAT,
          sample_rate: config.sttConfig.sampleRate,
          tts_sample_rate: config.ttsConfig.sampleRate,
          ...(isSttOnly ? { mode: "stt-only" } : {}),
        })
      );
    },

    async stop(): Promise<void> {
      if (conn === ConnState.Stopped) return;
      conn = ConnState.Stopped;
      sessionAbort.abort();
      metrics.sessionsActive.dec(agentLabel);

      const pending = turnPromise;
      if (pending) await pending;

      stt?.close();
      tts?.close();

      callHook("onDisconnect", (api) => api.onDisconnect(id, 5_000));
    },

    onAudio(data: Uint8Array): void {
      audioFrameCount++;
      if (audioFrameCount <= 3) {
        log.debug("audio frame", {
          frame: audioFrameCount,
          bytes: data.length,
        });
      }
      stt?.send(data);
    },

    onAudioReady(): void {
      if (agent !== AgentState.WaitingForAudio) return;
      agent = AgentState.Listening;

      if (pendingGreeting) {
        trySend(() => client.chat(pendingGreeting!));
        speakText(pendingGreeting);
        pendingGreeting = null;
      }
    },

    onCancel(): void {
      cancelInflight();
      stt?.clear();
      trySend(() => client.cancelled());

      if (agent === AgentState.Processing) {
        agent = AgentState.Listening;
      }
    },

    onReset(): void {
      cancelInflight();
      stt?.clear();
      messages = [];
      agent = AgentState.Listening;
      trySend(() => client.resetNotify());

      if (agentConfig.greeting) {
        trySend(() => client.chat(agentConfig.greeting));
        speakText(agentConfig.greeting);
      }
    },

    onHistory(
      incoming: readonly { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        const coreMsg: CoreUserMessage | CoreAssistantMessage = {
          role: msg.role,
          content: msg.text,
        };
        messages.push(coreMsg);
      }
      log.info("Restored conversation history", {
        count: incoming.length,
      });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

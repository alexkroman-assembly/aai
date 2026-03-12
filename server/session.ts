import type { PlatformConfig } from "./config.ts";
import { createModel } from "./model.ts";
import type { ExecuteTool } from "@aai/core/worker-entry";
import { createSttConnection, type SttConnection } from "./stt.ts";
import { createTtsConnection, type TtsConnection } from "./tts.ts";
import { getBuiltinVercelTools } from "./builtin_tools.ts";
import { executeTurn } from "./turn_handler.ts";
import type { STTConfig, TTSConfig } from "./types.ts";
import type { AgentConfig } from "@aai/sdk/types";
import type { ToolSchema } from "@aai/sdk/schema";
import type { WorkerApi } from "@aai/core/worker-entry";
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
import { AUDIO_FORMAT, PROTOCOL_VERSION } from "@aai/core/protocol";

export type SessionTransport = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: 0 | 1 | 2 | 3;
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
  createStt?: (apiKey: string, config: STTConfig) => SttConnection;
  createTts?: (config: TTSConfig) => TtsConnection;
};

// ── State enums ─────────────────────────────────────────────────────

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

// ── Session type ────────────────────────────────────────────────────

export type Session = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(data: Uint8Array): void;
  onAudioReady(): void;
  onCancel(): void;
  onReset(): void;
  onHistory(incoming: { role: "user" | "assistant"; text: string }[]): void;
  waitForTurn(): Promise<void>;
};

// ── Factory ─────────────────────────────────────────────────────────

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
  const ws = opts.transport;
  const agentLabel = { agent: opts.agent };
  const env = { ...opts.env };
  const getWorkerApi = opts.getWorkerApi;
  const slotEnv = opts.env
    ? Object.fromEntries(
      Object.entries(opts.env).filter((e): e is [string, string] =>
        e[1] !== undefined
      ),
    )
    : undefined;

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
    : buildSystemPrompt(agentConfig, hasTools, { voice: true });

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

  // ── Internal: transport ─────────────────────────────────────────

  function trySend(data: string | Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    } catch { /* ws closed between check and send */ }
  }

  function trySendJson(data: Record<string, unknown>): void {
    trySend(JSON.stringify(data));
  }

  // ── Internal: hooks ─────────────────────────────────────────────

  async function invokeHook(
    hook: string,
    extra?: {
      text?: string;
      error?: string;
      step?: {
        stepNumber: number;
        toolCalls: { toolName: string; args: Record<string, unknown> }[];
        text: string;
      };
    },
  ): Promise<void> {
    if (!getWorkerApi) return;
    try {
      cachedWorkerApi ??= await getWorkerApi();
      await cachedWorkerApi.invokeHook(hook, id, extra, 5_000, slotEnv);
    } catch (err: unknown) {
      console.error(`${hook} hook failed`, { err });
    }
  }

  // ── Internal: STT ───────────────────────────────────────────────

  async function connectStt(): Promise<void> {
    try {
      const handle = doCreateStt(config.apiKey, config.sttConfig);
      await handle.connect();

      handle.onTranscript = ({ text, isFinal, turnOrder }) => {
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
      };

      handle.onTurn = ({ text, turnOrder }) => {
        console.info("turn", { text, turnOrder });
        const prev = turnPromise;
        // deno-lint-ignore prefer-const
        let next!: Promise<void>;
        next = (async () => {
          try {
            await prev;
          } catch (e) {
            console.warn("previous turn failed", e);
          }
          try {
            await handleTurn(text, turnOrder);
          } finally {
            if (turnPromise === next) turnPromise = null;
          }
        })();
        turnPromise = next;
      };

      handle.onError = (err) => {
        console.error("STT error:", err.message);
        trySendJson({ type: "error", message: err.message });
      };

      handle.onClose = async () => {
        console.info("STT closed");
        stt = null;
        if (!sessionAbort.signal.aborted) {
          console.info("Attempting STT reconnect");
          try {
            await connectStt();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("STT reconnect failed:", msg);
            trySendJson({ type: "error", message: msg });
          }
        }
      };

      stt = handle;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("STT connect failed:", msg);
      trySendJson({ type: "error", message: msg });
    }
  }

  // ── Internal: turn handling ─────────────────────────────────────

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    cancelInflight();
    agent = AgentState.Processing;

    metrics.turnsTotal.inc(agentLabel);
    const turnStart = performance.now();

    trySendJson({
      type: "turn",
      text,
      ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
    });

    invokeHook("onTurn", { text });

    if (isSttOnly) {
      trySendJson({ type: "tts_done" });
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
            slotEnv,
          );
          if (resolved !== null) maxSteps = resolved;
        } catch (err: unknown) {
          console.warn("resolveMaxSteps failed, using default", { err });
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
            await invokeHook("onStep", { step: stepInfo });
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
                slotEnv,
              );
            } catch (err: unknown) {
              console.warn("resolveBeforeStep failed", { err });
              return null;
            }
          }
          : undefined,
      });
      if (signal.aborted) return;

      if (result) {
        trySendJson({ type: "chat", text: result });
        await tts!.synthesizeStream(
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
      if (
        err instanceof Error &&
        "responseBody" in err
      ) {
        const { responseBody, statusCode } = err as Error & {
          responseBody?: unknown;
          statusCode?: number;
        };
        console.error("Turn failed:", msg, { responseBody, statusCode });
      } else {
        console.error("Turn failed:", msg);
      }
      metrics.errorsTotal.inc({ ...agentLabel, component: "turn" });
      trySendJson({ type: "error", message: msg });
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
    // deno-lint-ignore prefer-const
    let p!: Promise<void>;
    p = (async () => {
      try {
        await tts.synthesizeStream(text, (chunk) => trySend(chunk), signal);
        if (!signal.aborted) trySendJson({ type: "tts_done" });
      } catch (err: unknown) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("TTS failed:", msg);
        trySendJson({ type: "error", message: msg });
      } finally {
        if (turnAbort === abort) turnAbort = null;
        if (turnPromise === p) turnPromise = null;
      }
    })();
    turnPromise = p;
  }

  // ── Public API ──────────────────────────────────────────────────

  return {
    async start(): Promise<void> {
      if (conn !== ConnState.Idle) return;
      conn = ConnState.Starting;

      metrics.sessionsTotal.inc(agentLabel);
      metrics.sessionsActive.inc(agentLabel);

      if (agentConfig.greeting) {
        pendingGreeting = agentConfig.greeting;
      }

      invokeHook("onConnect");
      await connectStt();

      conn = ConnState.Ready;
      trySendJson({
        type: "ready",
        protocol_version: PROTOCOL_VERSION,
        audio_format: AUDIO_FORMAT,
        sample_rate: config.sttConfig.sampleRate,
        tts_sample_rate: config.ttsConfig.sampleRate,
        ...(isSttOnly ? { mode: "stt-only" } : {}),
      });
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
      if (agent !== AgentState.WaitingForAudio) return;
      agent = AgentState.Listening;

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

      if (agent === AgentState.Processing) {
        agent = AgentState.Listening;
      }
    },

    onReset(): void {
      cancelInflight();
      stt?.clear();
      messages = [];
      agent = AgentState.Listening;
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
        const coreMsg: CoreUserMessage | CoreAssistantMessage = {
          role: msg.role,
          content: msg.text,
        };
        messages.push(coreMsg);
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

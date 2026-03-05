import type { PlatformConfig } from "./config.ts";
import { callLLM as defaultCallLLM, type CallLLMOptions } from "./llm.ts";
import { getLogger } from "./logger.ts";
import type { ExecuteTool } from "./tool_executor.ts";
import {
  connectStt as defaultConnectStt,
  type SttEvents,
  type SttHandle,
} from "./stt.ts";
import { createTtsClient } from "./tts.ts";
import { executeBuiltinTool as defaultExecuteBuiltinTool } from "./builtin_tools.ts";
import { executeTurn, type TurnCallLLMOptions } from "./turn_handler.ts";
import type {
  AgentConfig,
  ChatMessage,
  LLMResponse,
  STTConfig,
  ToolSchema,
} from "./types.ts";
import { DEFAULT_GREETING } from "./agent_types.ts";
import { buildSystemPrompt } from "./system_prompt.ts";

export interface SessionTransport {
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
}

export interface SessionOptions {
  id: string;
  transport: SessionTransport;
  agentConfig: AgentConfig;
  toolSchemas: ToolSchema[];
  platformConfig: PlatformConfig;
  executeTool: ExecuteTool;
  secrets?: Record<string, string | undefined>;
  skipGreeting?: boolean;
  connectStt?(
    apiKey: string,
    config: STTConfig,
    events: SttEvents,
  ): Promise<SttHandle>;
  callLLM?(opts: CallLLMOptions): Promise<LLMResponse>;
  ttsClient?: {
    synthesizeStream(
      chunks: AsyncIterable<string>,
      onAudio: (chunk: Uint8Array) => void,
      signal?: AbortSignal,
    ): Promise<void>;
    close(): void;
  };
  executeBuiltinTool?(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | null>;
}

export interface Session {
  start(): Promise<void>;
  stop(): Promise<void>;
  onAudio(data: Uint8Array): void;
  onAudioReady(): void;
  onCancel(): void;
  onReset(): void;
  onHistory(messages: { role: "user" | "assistant"; text: string }[]): void;
  waitForTurn(): Promise<void>;
}

export function createSession(opts: SessionOptions): Session {
  const {
    id,
    transport: ws,
    toolSchemas,
    platformConfig,
    executeTool,
  } = opts;

  const agentConfig = opts.skipGreeting
    ? { ...opts.agentConfig, greeting: "" }
    : opts.agentConfig;

  const secrets: Record<string, string | undefined> = {
    ...opts.secrets,
    BRAVE_API_KEY: platformConfig.braveApiKey || opts.secrets?.BRAVE_API_KEY,
  };
  const logger = getLogger(`session:${id.slice(0, 8)}`);

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

  const doConnectStt = opts.connectStt ?? defaultConnectStt;
  const doCallLLM = opts.callLLM ?? defaultCallLLM;
  const tts = opts.ttsClient ?? createTtsClient(config.ttsConfig);
  const doExecuteBuiltinTool = opts.executeBuiltinTool ??
    ((name: string, args: Record<string, unknown>) =>
      defaultExecuteBuiltinTool(name, args, secrets));

  let stt: SttHandle | null = null;
  let turnAbort: AbortController | null = null;
  let turnPromise: Promise<void> | null = null;
  let stopped = false;
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
    const builtin = await doExecuteBuiltinTool(name, args);
    return builtin ?? await executeTool(name, args);
  }

  function trySendJson(data: Record<string, unknown>): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    } catch (err: unknown) {
      logger.error("trySendJson failed", { err });
    }
  }

  function trySendBytes(data: Uint8Array): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch (err: unknown) {
      logger.error("trySendBytes failed", { err });
    }
  }

  function cancelInflight(): void {
    turnAbort?.abort();
    turnAbort = null;
  }

  async function doConnectSttWithEvents(): Promise<void> {
    const events: SttEvents = {
      onSpeechStarted: () => {
        if (turnAbort) {
          logger.info("User started speaking — interrupting playback");
          cancelInflight();
          trySendJson({ type: "cancelled" });
        }
      },
      onTranscript: (text, isFinal, turnOrder) => {
        logger.info("transcript", { text, isFinal, turnOrder });
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
        logger.info("turn", { text, turnOrder });
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
        logger.info("STT termination", { audioDuration, sessionDuration });
      },
      onError: (err) => {
        logger.error("STT error", { err });
        trySendJson({
          type: "error",
          message: "Speech recognition disconnected",
        });
      },
      onClose: () => {
        logger.info("STT closed");
        stt = null;
        if (!stopped) {
          logger.info("Attempting STT reconnect");
          doConnectSttWithEvents().catch((err) => {
            logger.error("STT reconnect failed", { err });
          });
        }
      },
    };

    try {
      stt = await doConnectStt(config.apiKey, config.sttConfig, events);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to connect STT", { error: msg });
      trySendJson({
        type: "error",
        message: "Failed to connect to speech recognition",
      });
    }
  }

  async function handleTurn(text: string, turnOrder?: number): Promise<void> {
    cancelInflight();

    trySendJson({
      type: "turn",
      text,
      ...(turnOrder !== undefined ? { turn_order: turnOrder } : {}),
    });

    const abort = new AbortController();
    turnAbort = abort;

    try {
      const result = await executeTurn(text, {
        messages,
        toolSchemas,
        callLLM: boundCallLLM,
        executeTool: boundExecuteTool,
        signal: abort.signal,
        logger,
      });
      if (abort.signal.aborted) return;

      if (result) {
        trySendJson({ type: "chat", text: result });
        await tts.synthesizeStream(
          (async function* () {
            yield result;
          })(),
          (chunk) => trySendBytes(chunk),
          abort.signal,
        );
        if (!abort.signal.aborted) trySendJson({ type: "tts_done" });
      } else {
        trySendJson({ type: "tts_done" });
      }
    } catch (err: unknown) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Chat failed", { error: msg });
      trySendJson({ type: "error", message: "Chat failed" });
    } finally {
      if (turnAbort === abort) turnAbort = null;
    }
  }

  function speakText(text: string): void {
    const abort = new AbortController();
    turnAbort = abort;
    async function* oneShot() {
      yield text;
    }
    const p = tts
      .synthesizeStream(oneShot(), (chunk) => trySendBytes(chunk), abort.signal)
      .then(() => {
        if (!abort.signal.aborted) trySendJson({ type: "tts_done" });
      })
      .catch(() => {})
      .finally(() => {
        if (turnAbort === abort) turnAbort = null;
        if (turnPromise === p) turnPromise = null;
      });
    turnPromise = p;
  }

  return {
    async start(): Promise<void> {
      const greeting = agentConfig.greeting ?? DEFAULT_GREETING;
      if (greeting) pendingGreeting = greeting;

      await doConnectSttWithEvents();
      trySendJson({
        type: "ready",
        sample_rate: config.sttConfig.sampleRate,
        tts_sample_rate: config.ttsConfig.sampleRate,
      });
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      const pending = turnPromise;
      cancelInflight();
      if (pending) await pending;
      stt?.close();
      tts.close();
    },

    onAudio(data: Uint8Array): void {
      audioFrameCount++;
      if (audioFrameCount <= 3) {
        logger.debug("audio frame", {
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

      const greeting = agentConfig.greeting ?? DEFAULT_GREETING;
      if (greeting) {
        trySendJson({ type: "chat", text: greeting });
        speakText(greeting);
      }
    },

    onHistory(
      incoming: { role: "user" | "assistant"; text: string }[],
    ): void {
      for (const msg of incoming) {
        messages.push({ role: msg.role, content: msg.text });
      }
      logger.info("Restored conversation history", {
        count: incoming.length,
      });
    },

    waitForTurn(): Promise<void> {
      return turnPromise ?? Promise.resolve();
    },
  };
}

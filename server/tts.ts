import { debounce } from "@std/async/debounce";
import type { TTSConfig } from "./types.ts";
import { createWebSocketWithHeaders } from "./_deno_ws.ts";

const IDLE_MS = 300;
const NO_AUDIO_TIMEOUT_MS = 5000;

export function createTtsClient(config: TTSConfig) {
  let ws: WebSocket | null = null;
  let disposed = false;

  let onAudioCb: ((chunk: Uint8Array) => void) | null = null;
  let completionResolve: (() => void) | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let chunkCount = 0;
  let totalBytes = 0;

  function buildUrl(): string {
    const params = new URLSearchParams({
      speaker: config.voice,
      modelId: config.modelId,
      audioFormat: config.audioFormat,
      samplingRate: String(config.samplingRate),
    });
    if (config.speedAlpha != null) {
      params.set("speedAlpha", String(config.speedAlpha));
    }
    return `${config.wssUrl}?${params}`;
  }

  function finishSynthesis(): void {
    idleFinish.clear();
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    if (completionResolve) {
      console.info("TTS synthesis done", { chunkCount, totalBytes });
      completionResolve();
      completionResolve = null;
    }
    onAudioCb = null;
    chunkCount = 0;
    totalBytes = 0;
  }

  const idleFinish = debounce(finishSynthesis, IDLE_MS);

  function handleMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
      chunkCount++;
      totalBytes += event.data.byteLength;
      onAudioCb?.(new Uint8Array(event.data));
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      idleFinish();
    }
  }

  let lastError: string | null = null;

  function handleClose(event: CloseEvent): void {
    if (event.code !== 1000 && event.code !== 1005) {
      lastError = event.reason
        ? `TTS connection closed: ${event.reason} (code ${event.code})`
        : `TTS connection closed unexpectedly (code ${event.code})`;
      console.error(lastError);
    }
    ws = null;
    finishSynthesis();
  }

  function handleError(): void {
    lastError = config.apiKey
      ? "TTS WebSocket error — check RIME_API_KEY"
      : "TTS WebSocket error — RIME_API_KEY is not set";
    console.error(lastError);
    ws = null;
    finishSynthesis();
  }

  function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(ws);
    }
    if (ws) {
      ws.close();
      ws = null;
    }

    const newWs = createWebSocketWithHeaders(buildUrl(), {
      Authorization: `Bearer ${config.apiKey}`,
    });
    newWs.binaryType = "arraybuffer";
    ws = newWs;

    newWs.addEventListener("message", handleMessage);
    newWs.addEventListener("close", handleClose);
    newWs.addEventListener("error", handleError);

    return new Promise<WebSocket>((resolve, reject) => {
      newWs.addEventListener("open", () => {
        lastError = null;
        console.info("TTS WebSocket connected");
        resolve(newWs);
      }, { once: true });
      newWs.addEventListener("error", () => {
        reject(new Error(lastError ?? "TTS WebSocket connection failed"));
      }, { once: true });
    });
  }

  function waitForCompletion(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      completionResolve = resolve;

      // Safety timeout in case no audio ever arrives
      safetyTimer = setTimeout(finishSynthesis, NO_AUDIO_TIMEOUT_MS);

      if (signal) {
        signal.addEventListener("abort", () => {
          console.info("TTS aborted", { chunkCount, totalBytes });
          // Close the WS so the next synthesis gets a fresh connection.
          // Sending <CLEAR> on the old socket isn't reliable — the server
          // may still have audio in flight that arrives after we start the
          // next synthesis, corrupting playback.
          if (ws) {
            ws.close();
            ws = null;
          }
          finishSynthesis();
        }, { once: true });
      }
    });
  }

  return {
    async synthesizeStream(
      chunks: string | AsyncIterable<string>,
      onAudio: (chunk: Uint8Array) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      if (disposed || signal?.aborted) return;

      console.info("synthesizeStream start", { voice: config.voice });

      const conn = await connect();
      if (signal?.aborted) return;

      onAudioCb = onAudio;
      if (typeof chunks === "string") {
        conn.send(chunks);
      } else {
        for await (const text of chunks) {
          if (signal?.aborted) return;
          conn.send(text);
        }
      }
      conn.send("<FLUSH>");
      await waitForCompletion(signal);
    },

    close(): void {
      disposed = true;
      finishSynthesis();
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("<EOS>");
        }
        ws.close();
        ws = null;
      }
    },
  };
}

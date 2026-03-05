import { getLogger } from "./logger.ts";
import type { TTSConfig } from "./types.ts";
import { createWebSocket, safeClose } from "./ws.ts";

const log = getLogger("tts");

export function createTtsClient(config: TTSConfig) {
  let warmWs: WebSocket | null = null;
  let disposed = false;

  function makeWs(): WebSocket {
    const ws = createWebSocket(config.wssUrl, {
      Authorization: `Api-Key ${config.apiKey}`,
    });
    ws.binaryType = "arraybuffer";
    return ws;
  }

  function warmUp(): void {
    if (disposed || !config.apiKey) return;

    if (warmWs) {
      safeClose(warmWs);
      warmWs = null;
    }

    const ws = makeWs();
    ws.addEventListener("error", () => {
      if (warmWs === ws) warmWs = null;
    });
    warmWs = ws;
  }

  function runTtsProtocol(
    ws: WebSocket,
    text: string,
    onAudio: (chunk: Uint8Array) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      const { signal: listenerSignal } = ac;
      const cleanup = () => {
        ac.abort();
        safeClose(ws);
      };

      let chunkCount = 0;
      let totalBytes = 0;

      const onAbort = () => {
        log.info("TTS aborted", { chunkCount, totalBytes });
        cleanup();
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      const sendText = () => {
        log.info("TTS sending text to WebSocket", {
          wordCount: text.split(/\s+/).filter(Boolean).length,
        });
        ws.send(
          JSON.stringify({
            voice: config.voice,
            max_tokens: config.maxTokens,
            buffer_size: config.bufferSize,
            repetition_penalty: config.repetitionPenalty,
            temperature: config.temperature,
            top_p: config.topP,
          }),
        );
        for (const word of text.split(/\s+/)) {
          if (word) ws.send(word);
        }
        ws.send("__END__");
      };

      if (ws.readyState === WebSocket.OPEN) {
        sendText();
      } else {
        ws.addEventListener("open", sendText, { signal: listenerSignal });
      }

      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          chunkCount++;
          totalBytes += event.data.byteLength;
          onAudio(new Uint8Array(event.data));
        }
      }, { signal: listenerSignal });

      ws.addEventListener("close", (event: CloseEvent) => {
        ac.abort();
        signal?.removeEventListener("abort", onAbort);
        warmUp();
        if (event.code !== 1000 && event.code !== 1005) {
          log.error("TTS WebSocket closed unexpectedly", {
            code: event.code,
            reason: event.reason,
            chunkCount,
            totalBytes,
          });
          reject(
            new Error(
              `TTS WebSocket closed unexpectedly (code ${event.code})`,
            ),
          );
        } else {
          log.info("TTS complete", {
            code: event.code,
            chunkCount,
            totalBytes,
          });
          resolve();
        }
      });

      ws.addEventListener("error", () => {
        log.error("TTS WebSocket error", { chunkCount, totalBytes });
        signal?.removeEventListener("abort", onAbort);
        cleanup();
        reject(new Error("TTS WebSocket error"));
      });
    });
  }

  warmUp();

  return {
    synthesize(
      text: string,
      onAudio: (chunk: Uint8Array) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      if (signal?.aborted) {
        log.info("synthesize skipped (already aborted)");
        return Promise.resolve();
      }

      if (!config.apiKey) {
        throw new Error(
          "TTS API key not configured — set ASSEMBLYAI_TTS_API_KEY on the server",
        );
      }

      log.info("synthesize start", {
        textLength: text.length,
        text: text.length > 200 ? text.slice(0, 200) + "\u2026" : text,
        voice: config.voice,
      });

      let ws: WebSocket;
      if (warmWs && warmWs.readyState === WebSocket.OPEN) {
        ws = warmWs;
        warmWs = null;
        log.info("using warm WebSocket");
      } else {
        if (warmWs) {
          safeClose(warmWs);
          warmWs = null;
        }
        ws = makeWs();
        log.info("created new WebSocket");
      }

      return runTtsProtocol(ws, text, onAudio, signal);
    },
    close(): void {
      disposed = true;
      if (warmWs) {
        safeClose(warmWs);
        warmWs = null;
      }
    },
  };
}

export type TtsClient = ReturnType<typeof createTtsClient>;

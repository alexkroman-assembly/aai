import { deadline } from "@std/async/deadline";
import { type STTConfig, SttMessageSchema } from "./types.ts";
import { createWebSocketWithHeaders } from "./_deno_ws.ts";

const STT_CONNECTION_TIMEOUT = 10_000;

export type SttEvents = {
  onTranscript: (text: string, isFinal: boolean, turnOrder?: number) => void;
  onTurn: (text: string, turnOrder?: number) => void;
  onTermination: (audioDuration: number, sessionDuration: number) => void;
  onError: (err: Error) => void;
  onClose: () => void;
};

export type SttHandle = {
  send: (audio: Uint8Array) => void;
  clear: () => void;
  close: () => void;
};

export async function connectStt(
  apiKey: string,
  config: STTConfig,
  events: SttEvents,
): Promise<SttHandle> {
  const params = new URLSearchParams({
    sample_rate: String(config.sampleRate),
    speech_model: config.speechModel,
    format_turns: String(config.formatTurns),
    min_end_of_turn_silence_when_confident: String(
      config.minEndOfTurnSilenceWhenConfident,
    ),
    max_turn_silence: String(config.maxTurnSilence),
    vad_threshold: String(config.vadThreshold),
  });
  if (config.prompt) {
    params.set("prompt", config.prompt);
  }

  const url = `${config.wssBase}?${params}`;
  console.info("Connecting to STT", {
    url: config.wssBase,
    params: Object.fromEntries(params),
  });
  const ws = createWebSocketWithHeaders(url, {
    Authorization: apiKey,
  });

  // Wait for connection
  try {
    await deadline(
      new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", (event: Event) => {
          const detail = event instanceof ErrorEvent ? event.message : "";
          const msg = apiKey
            ? `STT connection failed${detail ? `: ${detail}` : ""}`
            : "STT connection failed — ASSEMBLYAI_API_KEY is not set";
          reject(new Error(msg));
        }, { once: true });
      }),
      STT_CONNECTION_TIMEOUT,
    );
  } catch (err: unknown) {
    ws.close();
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("STT connection timeout");
    }
    throw err;
  }

  console.info("STT WebSocket connected");

  // Wire up event handlers — flat, no nesting
  let msgCount = 0;

  ws.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      console.debug("STT non-string message", {
        dataType: typeof event.data,
      });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }

    const result = SttMessageSchema.safeParse(json);
    if (!result.success) return;

    const msg = result.data;
    msgCount++;
    console.info("STT message", {
      msgCount,
      type: msg.type,
      transcript: msg.transcript?.slice(0, 100),
      isFinal: msg.is_final,
      turnOrder: msg.turn_order,
      endOfTurn: msg.end_of_turn,
      turnIsFormatted: msg.turn_is_formatted,
    });
    switch (msg.type) {
      case "Termination":
        events.onTermination(
          msg.audio_duration_seconds ?? 0,
          msg.session_duration_seconds ?? 0,
        );
        break;
      case "Turn": {
        const text = (msg.transcript ?? "").trim();
        if (!text) break;
        if (msg.end_of_turn) {
          events.onTurn(text, msg.turn_order);
        } else {
          events.onTranscript(text, false, msg.turn_order);
        }
        break;
      }
    }
  });

  ws.addEventListener("error", (event: Event) => {
    const detail = event instanceof ErrorEvent ? event.message : "";
    const msg = `STT error${detail ? `: ${detail}` : ""}`;
    events.onError(new Error(msg));
  });

  ws.addEventListener("close", (event: CloseEvent) => {
    console.info("STT WebSocket closed", {
      code: event.code,
      reason: event.reason ?? "",
      msgCount,
    });
    if (event.code !== 1000 && event.code !== 1005) {
      console.error("WebSocket closed unexpectedly", {
        code: event.code,
        reason: event.reason ?? "",
      });
      events.onError(
        new Error(
          `STT WebSocket closed unexpectedly (code ${event.code})`,
        ),
      );
    }
    events.onClose();
  });

  return {
    send(audio: Uint8Array) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(audio);
      } else {
        console.warn("STT send skipped, ws not open", {
          wsState: ws.readyState,
        });
      }
    },
    clear() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ForceEndpoint" }));
      }
    },
    close() {
      ws.close();
    },
  };
}

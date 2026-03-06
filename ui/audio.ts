import { MIC_BUFFER_SECONDS } from "./types.ts";
import { resample } from "./resample.ts";

export interface VoiceIOOptions {
  sttSampleRate: number;
  ttsSampleRate: number;
  captureWorkletSrc: string;
  playbackWorkletSrc: string;
  onMicData: (pcm16: ArrayBuffer) => void;
}

export interface VoiceIO extends AsyncDisposable {
  enqueue(pcm16Buffer: ArrayBuffer): void;
  /** Signal that TTS is complete — worklet will drain remaining audio then stop. */
  done(): void;
  /** Immediately interrupt and discard buffered audio. */
  flush(): void;
  close(): Promise<void>;
}

async function loadWorklet(
  ctx: AudioContext,
  source: string,
): Promise<void> {
  // source is already a blob: URL (created by the worklet module)
  await ctx.audioWorklet.addModule(source);
}

export async function createVoiceIO(
  opts: VoiceIOOptions,
): Promise<VoiceIO> {
  const {
    sttSampleRate,
    ttsSampleRate,
    captureWorkletSrc,
    playbackWorkletSrc,
    onMicData,
  } = opts;

  // Use TTS rate for the context — playback fidelity is more perceptible.
  // Capture path resamples to STT rate if they differ.
  const contextRate = ttsSampleRate;
  const ctx = new AudioContext({
    sampleRate: contextRate,
    latencyHint: "playback",
  });
  await ctx.resume();

  // Single AudioContext owns both capture and playback — required for AEC.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: contextRate,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  // Load both worklet modules in parallel
  try {
    await Promise.all([
      loadWorklet(ctx, captureWorkletSrc),
      loadWorklet(ctx, playbackWorkletSrc),
    ]);
  } catch (err: unknown) {
    for (const t of stream.getTracks()) t.stop();
    await ctx.close().catch(() => {});
    throw err;
  }

  // ── Capture ──
  const mic = ctx.createMediaStreamSource(stream);
  const capNode = new AudioWorkletNode(ctx, "capture-processor", {
    channelCount: 1,
    channelCountMode: "explicit",
  });
  mic.connect(capNode);

  // Accumulate chunks to match the target buffer size before calling onMicData
  const chunkSizeBytes = Math.floor(sttSampleRate * MIC_BUFFER_SECONDS) * 2;
  let capBuffer = new ArrayBuffer(0);

  capNode.port.postMessage({ event: "start" });

  capNode.port.onmessage = (e: MessageEvent) => {
    if (e.data.event !== "chunk") return;
    const chunk = e.data.buffer as ArrayBuffer;

    // Resample from context rate to STT rate if needed
    let pcm16: ArrayBuffer;
    if (contextRate !== sttSampleRate) {
      const int16 = new Int16Array(chunk);
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;
      const resampled = resample(floats, contextRate, sttSampleRate);
      const out = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = resampled[i] * 32768;
        out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
      }
      pcm16 = out.buffer as ArrayBuffer;
    } else {
      pcm16 = chunk;
    }

    // Accumulate until we have enough
    const merged = new ArrayBuffer(capBuffer.byteLength + pcm16.byteLength);
    const mergedView = new Uint8Array(merged);
    mergedView.set(new Uint8Array(capBuffer), 0);
    mergedView.set(new Uint8Array(pcm16), capBuffer.byteLength);
    capBuffer = merged;

    if (capBuffer.byteLength >= chunkSizeBytes) {
      onMicData(capBuffer);
      capBuffer = new ArrayBuffer(0);
    }
  };

  // ── Playback ──
  // Pass raw bytes straight to the worklet — no conversion on main thread.
  let playNode: AudioWorkletNode | null = null;
  let closed = false;

  function ensurePlayNode(): AudioWorkletNode {
    if (playNode) return playNode;
    const node = new AudioWorkletNode(ctx, "playback-processor");
    node.connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data.event === "stop") {
        node.disconnect();
        if (playNode === node) playNode = null;
      }
    };
    playNode = node;
    return node;
  }

  const io: VoiceIO = {
    enqueue(pcm16Buffer: ArrayBuffer) {
      if (closed) return;
      if (pcm16Buffer.byteLength === 0) return;
      const node = ensurePlayNode();
      node.port.postMessage(
        { event: "write", buffer: new Uint8Array(pcm16Buffer) },
        [pcm16Buffer],
      );
    },

    done() {
      if (playNode) playNode.port.postMessage({ event: "done" });
    },

    flush() {
      if (playNode) playNode.port.postMessage({ event: "interrupt" });
    },

    async close() {
      if (closed) return;
      closed = true;
      capNode.port.postMessage({ event: "stop" });
      for (const t of stream.getTracks()) t.stop();
      await ctx.close().catch(() => {});
    },

    async [Symbol.asyncDispose]() {
      await io.close();
    },
  };
  return io;
}

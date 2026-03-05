// Capture worklet: accumulates mic Float32 samples, converts to Int16 PCM,
// and sends chunks back to the main thread via postMessage.
// Modeled after pipecat's audio_processor worklet.

const CaptureProcessorWorklet = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.chunks = [];
    this.port.onmessage = (e) => {
      if (e.data.event === 'start') this.recording = true;
      else if (e.data.event === 'stop') this.recording = false;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || !this.recording) return true;

    // Mono: use first channel
    const samples = input[0];

    // Convert Float32 -> Int16
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    this.port.postMessage({ event: 'chunk', buffer }, [buffer]);
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
`;

const script = new Blob([CaptureProcessorWorklet], {
  type: "application/javascript",
});
const src = URL.createObjectURL(script);
export default src;

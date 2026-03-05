// Playback worklet: receives Int16 PCM chunks via postMessage, converts to
// Float32, queues them, and shifts 128-sample buffers into process() output.
// Modeled after pipecat's stream_processor worklet.

const PlaybackProcessorWorklet = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hasStarted = false;
    this.hasInterrupted = false;
    this.outputBuffers = [];
    this.bufferLength = 128;
    this.write = { buffer: new Float32Array(this.bufferLength) };
    this.writeOffset = 0;
    this.port.onmessage = (e) => {
      const payload = e.data;
      if (payload.event === 'write') {
        const int16Array = payload.buffer;
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 0x8000;
        }
        this.writeData(float32Array);
      } else if (payload.event === 'interrupt') {
        this.hasInterrupted = true;
      }
    };
  }

  writeData(float32Array) {
    let { buffer } = this.write;
    let offset = this.writeOffset;
    for (let i = 0; i < float32Array.length; i++) {
      buffer[offset++] = float32Array[i];
      if (offset >= buffer.length) {
        this.outputBuffers.push(this.write);
        this.write = { buffer: new Float32Array(this.bufferLength) };
        buffer = this.write.buffer;
        offset = 0;
      }
    }
    this.writeOffset = offset;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const outputChannelData = output[0];
    if (this.hasInterrupted) {
      this.hasInterrupted = false;
      this.hasStarted = false;
      this.outputBuffers = [];
      this.write = { buffer: new Float32Array(this.bufferLength) };
      this.writeOffset = 0;
      outputChannelData.fill(0);
      this.port.postMessage({ event: 'interrupted' });
      return true;
    } else if (this.outputBuffers.length) {
      this.hasStarted = true;
      const { buffer } = this.outputBuffers.shift();
      for (let i = 0; i < outputChannelData.length; i++) {
        outputChannelData[i] = buffer[i] || 0;
      }
      return true;
    } else if (this.hasStarted) {
      this.hasStarted = false;
      outputChannelData.fill(0);
      this.port.postMessage({ event: 'drained' });
      return true;
    } else {
      outputChannelData.fill(0);
      return true;
    }
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
`;

const script = new Blob([PlaybackProcessorWorklet], {
  type: "application/javascript",
});
const src = URL.createObjectURL(script);
export default src;

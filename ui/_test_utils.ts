import { installDomShim } from "./_dom_shim.ts";
import { DOMParser } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import type { SessionSignals } from "./signals.tsx";
import type { AgentState, Message, SessionError } from "./types.ts";

const HTML =
  `<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>`;

export function setupDOM() {
  installDomShim();
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

export function getContainer(): Element {
  return globalThis.document.querySelector("#app")!;
}

// Ensure document exists at import time for modules using goober css``.
setupDOM();

export {
  installMockWebSocket,
  MockWebSocket,
} from "@aai/server/testing/mock-ws";

export const flush = () => new Promise<void>((r) => queueMicrotask(r));

export function installMockLocation(origin = "http://localhost:3000") {
  const had = "location" in globalThis;
  // deno-lint-ignore no-explicit-any
  if (!had) (globalThis as any).location = { origin };
  return {
    restore() {
      // deno-lint-ignore no-explicit-any
      if (!had) delete (globalThis as any).location;
    },
  };
}

// ── Audio mock helpers ──

export class MockMediaStreamTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

export class MockMediaStream {
  private tracks = [new MockMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

export class MockMessagePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  postMessage(data: unknown, _transfer?: Transferable[]) {
    this.posted.push(data);
  }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

export class MockAudioWorkletNode {
  port = new MockMessagePort();
  connected: MockAudioNode[] = [];
  name: string;
  options: unknown;
  constructor(
    _ctx: MockAudioContext,
    name: string,
    options?: unknown,
  ) {
    this.name = name;
    this.options = options;
  }
  connect(dest: MockAudioNode) {
    this.connected.push(dest);
  }
  disconnect() {}
}

export class MockAudioNode {
  connected: (MockAudioNode | MockAudioWorkletNode)[] = [];
  connect(dest: MockAudioNode | MockAudioWorkletNode) {
    this.connected.push(dest);
  }
}

export class MockGainNode extends MockAudioNode {
  gain = {
    value: 1,
    setTargetAtTime(value: number, _startTime: number, _tc: number) {
      this.value = value;
    },
  };
}

export class MockAudioContext {
  sampleRate: number;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new MockAudioNode();
  audioWorklet = {
    modules: [] as string[],
    addModule(url: string) {
      this.modules.push(url);
      return Promise.resolve();
    },
  };
  closed = false;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100;
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource(_stream: MockMediaStream) {
    return new MockAudioNode();
  }
  createGain() {
    return new MockGainNode();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

export interface AudioMockContext {
  lastContext: () => MockAudioContext;
  workletNodes: () => MockAudioWorkletNode[];
}

/**
 * Install Web Audio API mocks on globalThis and run `fn`.
 * All mocks are restored after `fn` completes.
 */
export function withAudioMocks(
  fn: (ctx: AudioMockContext) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const origAudioContext = globalThis.AudioContext;
    const origAudioWorkletNode = globalThis.AudioWorkletNode;
    // deno-lint-ignore no-explicit-any
    const nav = globalThis.navigator as any;
    const origGetUserMedia = nav?.mediaDevices?.getUserMedia;

    let _lastContext: MockAudioContext;
    const _workletNodes: MockAudioWorkletNode[] = [];

    // deno-lint-ignore no-explicit-any
    (globalThis as any).AudioContext = class extends MockAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts);
        _lastContext = this;
      }
    };

    // deno-lint-ignore no-explicit-any
    (globalThis as any).AudioWorkletNode = class extends MockAudioWorkletNode {
      constructor(ctx: MockAudioContext, name: string, options?: unknown) {
        super(ctx, name, options);
        _workletNodes.push(this);
      }
    };

    if (!nav.mediaDevices) nav.mediaDevices = {};
    nav.mediaDevices.getUserMedia = () =>
      Promise.resolve(new MockMediaStream());

    try {
      await fn({
        lastContext: () => _lastContext,
        workletNodes: () => _workletNodes,
      });
    } finally {
      globalThis.AudioContext = origAudioContext;
      globalThis.AudioWorkletNode = origAudioWorkletNode;
      if (origGetUserMedia) {
        nav.mediaDevices.getUserMedia = origGetUserMedia;
      }
    }
  };
}

export function findWorkletNode(
  nodes: MockAudioWorkletNode[],
  name: string,
): MockAudioWorkletNode {
  const node = nodes.find((n) => n.name === name);
  if (!node) throw new Error(`No worklet node named "${name}"`);
  return node;
}

// ── Mock signals ──

export function createMockSignals(
  overrides?: Partial<{
    state: AgentState;
    messages: Message[];
    transcript: string;
    error: SessionError | null;
    started: boolean;
    running: boolean;
  }>,
): SessionSignals {
  const signals: SessionSignals = {
    state: signal<AgentState>(overrides?.state ?? "connecting"),
    messages: signal<Message[]>(overrides?.messages ?? []),
    transcript: signal<string>(overrides?.transcript ?? ""),
    error: signal<SessionError | null>(overrides?.error ?? null),
    started: signal<boolean>(overrides?.started ?? false),
    running: signal<boolean>(overrides?.running ?? true),
    dispose() {},
    [Symbol.dispose]() {},
    start() {
      signals.started.value = true;
      signals.running.value = true;
    },
    toggle() {
      signals.running.value = !signals.running.value;
    },
    reset() {},
  };

  return signals;
}

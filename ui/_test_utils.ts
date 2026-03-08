import { installDomShim } from "./_dom_shim.ts";
import { DOMParser } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import type { SessionSignals } from "./signals.tsx";
import type { AgentState, Message, SessionError } from "./types.ts";

const HTML =
  `<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>`;

// deno-lint-ignore no-explicit-any
const g = globalThis as any;

export function setupDOM() {
  installDomShim();
  const doc = new DOMParser().parseFromString(HTML, "text/html")!;
  g.document = doc;
  return doc;
}

export function getContainer(): Element {
  return globalThis.document.querySelector("#app")!;
}

// Ensure document exists at import time for modules using goober css``.
setupDOM();

// ── Mock WebSocket (local copy to avoid pulling server/ into the binary) ──

export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = "arraybuffer";
  sent: (string | ArrayBuffer | Uint8Array)[] = [];
  url: string;

  constructor(
    url: string | URL,
    _protocols?: string | string[] | Record<string, unknown>,
  ) {
    super();
    this.url = typeof url === "string" ? url : url.toString();
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
      }
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close(code?: number, _reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code: code ?? 1000 }));
  }

  simulateMessage(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  msg(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  disconnect(code = 1000) {
    this.dispatchEvent(new CloseEvent("close", { code }));
  }

  error() {
    this.dispatchEvent(new Event("error"));
  }

  sentJson(): Record<string, unknown>[] {
    return this.sent
      .filter((d): d is string => typeof d === "string")
      .map((s) => JSON.parse(s));
  }
}

// deno-lint-ignore no-explicit-any
const _g = globalThis as any;

export function installMockWebSocket(): {
  restore: () => void;
  created: MockWebSocket[];
  get lastWs(): MockWebSocket | null;
  [Symbol.dispose]: () => void;
} {
  const saved = globalThis.WebSocket;
  const created: MockWebSocket[] = [];

  _g.WebSocket = class extends MockWebSocket {
    constructor(
      url: string | URL,
      protocols?: string | string[] | Record<string, unknown>,
    ) {
      super(url, protocols);
      created.push(this);
    }
  };

  return {
    created,
    get lastWs() {
      return created.length > 0 ? created[created.length - 1] : null;
    },
    restore() {
      globalThis.WebSocket = saved;
    },
    [Symbol.dispose]() {
      globalThis.WebSocket = saved;
    },
  };
}

export const flush = () => new Promise<void>((r) => queueMicrotask(r));

export function installMockLocation(origin = "http://localhost:3000") {
  const had = "location" in globalThis;
  if (!had) g.location = { origin };
  return {
    restore() {
      if (!had) delete g.location;
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

export type AudioMockContext = {
  lastContext: () => MockAudioContext;
  workletNodes: () => MockAudioWorkletNode[];
};

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
    const nav = g.navigator;
    const origGetUserMedia = nav?.mediaDevices?.getUserMedia;

    let _lastContext: MockAudioContext;
    const _workletNodes: MockAudioWorkletNode[] = [];

    g.AudioContext = class extends MockAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts);
        _lastContext = this;
      }
    };

    g.AudioWorkletNode = class extends MockAudioWorkletNode {
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

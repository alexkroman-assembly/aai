import { FakeTime } from "@std/testing/time";
import { render } from "preact";
import { installDomShim } from "./_dom_shim.ts";
import { DOMParser } from "@b-fuze/deno-dom";
import { signal } from "@preact/signals";
import { createVoiceSession, type VoiceSession } from "./session.ts";
import { createSessionControls, type SessionSignals } from "./signals.ts";
import type { AgentState, Message, SessionError } from "./types.ts";
export { installMockWebSocket, MockWebSocket } from "../core/_mock_ws.ts";
import { installMockWebSocket } from "../core/_mock_ws.ts";

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

// Ensure document exists at import time for modules that need DOM globals.
setupDOM();

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

// ── Test environment wrappers ──

/**
 * Set up a DOM + FakeTime environment, run `fn`, then clean up.
 * Used by component tests that need a container and timer control.
 */
export function withDOM(
  fn: (container: Element) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const time = new FakeTime();
    try {
      setupDOM();
      const container = getContainer();
      try {
        await fn(container);
      } finally {
        render(null, container);
        await time.tickAsync(100);
      }
    } finally {
      time.restore();
    }
  };
}

/**
 * Set up DOM + mock WebSocket, run `fn`, then clean up.
 * Used by mount tests.
 */
export function withMountEnv(
  fn: (mock: ReturnType<typeof installMockWebSocket>) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    setupDOM();
    const mock = installMockWebSocket();
    try {
      await fn(mock);
    } finally {
      const app = globalThis.document.querySelector("#app");
      if (app) render(null, app as Element);
      await new Promise<void>((r) => setTimeout(r, 0));
      mock.restore();
    }
  };
}

/**
 * Set up mock WebSocket + location + session + signals, run `fn`, clean up.
 * Used by signals tests.
 */
export function withSignalsEnv(
  fn: (ctx: {
    mock: ReturnType<typeof installMockWebSocket>;
    session: VoiceSession;
    signals: ReturnType<typeof createSessionControls>;
    connect: () => Promise<void>;
    send: (msg: Record<string, unknown>) => void;
  }) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const mock = installMockWebSocket();
    const loc = installMockLocation();
    const session = createVoiceSession({
      platformUrl: "http://localhost:3000",
    });
    const signals = createSessionControls(session);
    try {
      await fn({
        mock,
        session,
        signals,
        async connect() {
          session.connect();
          await flush();
        },
        send(msg) {
          mock.lastWs!.simulateMessage(JSON.stringify(msg));
        },
      });
    } finally {
      mock.restore();
      loc.restore();
    }
  };
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

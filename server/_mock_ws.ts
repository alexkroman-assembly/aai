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
const g = globalThis as any;

export function installMockWebSocket(): {
  restore: () => void;
  created: MockWebSocket[];
  get lastWs(): MockWebSocket | null;
  [Symbol.dispose]: () => void;
} {
  const saved = globalThis.WebSocket;
  const created: MockWebSocket[] = [];

  g.WebSocket = class extends MockWebSocket {
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

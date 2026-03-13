// Copyright 2025 the AAI authors. MIT license.
/**
 * Shared bidirectional postMessage RPC helpers.
 *
 * Both host↔worker and host↔sandbox use the same protocol:
 * - {@linkcode RpcRequest} / {@linkcode RpcResponse} messages
 * - {@linkcode createRpcClient} to send requests and track pending promises
 * - {@linkcode createRpcServer} to dispatch incoming requests to handlers
 *
 * @module
 */

/** A request message sent over postMessage. */
export type RpcRequest = {
  type: "rpc-request";
  id: number;
  method: string;
  args: unknown[];
};

/** A response message sent over postMessage. */
export type RpcResponse = {
  type: "rpc-response";
  id: number;
  result?: unknown;
  error?: string;
};

/** Either an RPC request or response. */
export type RpcMessage = RpcRequest | RpcResponse;

/** Type guard for RPC messages. */
export function isRpcMessage(data: unknown): data is RpcMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  return msg.type === "rpc-request" || msg.type === "rpc-response";
}

/** An RPC client that can send requests and resolve responses. */
export type RpcClient = {
  /** Send an RPC request and return a promise for the result. */
  call(method: string, ...args: unknown[]): Promise<unknown>;
  /** Handle an incoming RPC response message. Returns true if handled. */
  handleResponse(msg: RpcResponse): boolean;
};

/**
 * Create an RPC client that sends requests via the given `postFn`.
 *
 * @param postFn - Function to post a message (e.g. `worker.postMessage`).
 */
export function createRpcClient(
  postFn: (msg: RpcRequest) => void,
): RpcClient {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  return {
    call(method, ...args) {
      const id = nextId++;
      const promise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      postFn({ type: "rpc-request", id, method, args });
      return promise;
    },
    handleResponse(msg) {
      const entry = pending.get(msg.id);
      if (!entry) return false;
      pending.delete(msg.id);
      if (msg.error !== undefined) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
      return true;
    },
  };
}

/** Handler map for an RPC server. */
export type RpcHandlers = Record<
  string,
  (...args: unknown[]) => unknown | Promise<unknown>
>;

/** An RPC server that dispatches incoming requests to handlers. */
export type RpcServer = {
  /** Handle an incoming RPC request message. Returns true if handled. */
  handleRequest(msg: RpcRequest): boolean;
};

/**
 * Create an RPC server that dispatches requests to `handlers` and posts
 * responses via `postFn`.
 *
 * @param handlers - Map of method names to handler functions.
 * @param postFn - Function to post a response message.
 */
export function createRpcServer(
  handlers: RpcHandlers,
  postFn: (msg: RpcResponse) => void,
): RpcServer {
  return {
    handleRequest(msg) {
      const handler = handlers[msg.method];
      if (!handler) {
        postFn({
          type: "rpc-response",
          id: msg.id,
          error: `Unknown RPC method: ${msg.method}`,
        });
        return true;
      }
      Promise.resolve()
        .then(() => handler(...msg.args))
        .then(
          (result) => postFn({ type: "rpc-response", id: msg.id, result }),
          (err) =>
            postFn({
              type: "rpc-response",
              id: msg.id,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
      return true;
    },
  };
}

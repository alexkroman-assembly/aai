// Copyright 2025 the AAI authors. MIT license.
import { createRpcServer, isRpcMessage, type RpcHandlers } from "@aai/sdk/rpc";

const output: string[] = [];
function capture(...args: unknown[]) {
  output.push(args.map(String).join(" "));
}

const fakeConsole = {
  log: capture,
  info: capture,
  warn: capture,
  error: capture,
  debug: capture,
};

const handlers: RpcHandlers = {
  async execute(code: unknown) {
    output.length = 0;
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const fn = new AsyncFunction("console", code as string);
    try {
      await fn(fakeConsole);
      return { output: output.join("\n") };
    } catch (err: unknown) {
      return {
        output: output.join("\n"),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

function post(msg: unknown) {
  self.postMessage(msg);
}
const rpcServer = createRpcServer(handlers, post);

self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  if (isRpcMessage(data) && data.type === "rpc-request") {
    rpcServer.handleRequest(data);
  }
};

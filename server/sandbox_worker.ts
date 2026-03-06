// Worker entry point for sandboxed code execution.
// Spawned with all permissions denied for isolation.

import { serveRpc } from "../sdk/_rpc.ts";

serveRpc(
  self as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage(m: unknown): void;
  },
  {
    execute: ({ code }: Record<string, unknown>) => {
      const output: string[] = [];
      const capture = (...args: unknown[]) =>
        output.push(args.map(String).join(" "));

      const fakeConsole = {
        log: capture,
        info: capture,
        warn: capture,
        error: capture,
        debug: capture,
      };

      const AsyncFunction = Object.getPrototypeOf(async function () {})
        .constructor;
      const fn = new AsyncFunction("console", code as string);
      return fn(fakeConsole).then(
        () => ({ output: output.join("\n") }),
        (err: unknown) => ({
          output: output.join("\n"),
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    },
  },
);

// Copyright 2025 the AAI authors. MIT license.
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import { asMessagePort } from "@aai/sdk/capnweb-transport";

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

/**
 * Cap'n Web RPC target for sandboxed code execution.
 *
 * Exposes a single `execute` method that runs arbitrary JavaScript
 * in a locked-down Deno Worker with no permissions.
 *
 * Returned by {@linkcode SandboxGate.authenticate} — the host must
 * authenticate before executing any code.
 */
class SandboxTarget extends RpcTarget {
  async execute(code: string): Promise<{ output: string; error?: string }> {
    output.length = 0;
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor;
    const fn = new AsyncFunction("console", code);
    try {
      await fn(fakeConsole);
      return { output: output.join("\n") };
    } catch (err: unknown) {
      return {
        output: output.join("\n"),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/**
 * Gate target — the initial capability exposed to the host.
 *
 * The host must call `authenticate()` to obtain the
 * {@linkcode SandboxTarget} capability for code execution.
 * This ensures untrusted code in the sandbox cannot self-activate.
 */
class SandboxGate extends RpcTarget {
  #authenticated = false;

  authenticate(): SandboxTarget {
    if (this.#authenticated) {
      throw new Error("Already authenticated");
    }
    this.#authenticated = true;
    return new SandboxTarget();
  }
}

newMessagePortRpcSession(asMessagePort(self), new SandboxGate());

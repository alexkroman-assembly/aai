// Copyright 2025 the AAI authors. MIT license.
import { stub } from "@std/testing/mock";
import { _internals } from "./_new.ts";
import type { BundleOutput } from "./_bundler.ts";

/** Create a temp directory, run `fn`, then clean up. */
export async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "aai_test_" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Stub _internals.step to suppress output in tests. */
export function silenceSteps(): {
  restore: () => void;
  [Symbol.dispose]: () => void;
} {
  const stepStub = stub(_internals, "step", () => {});
  const restore = () => stepStub.restore();
  return { restore, [Symbol.dispose]: restore };
}

/** Create a minimal BundleOutput for deploy tests. */
export function makeBundle(overrides?: Partial<BundleOutput>): BundleOutput {
  return {
    worker: "// worker",
    html: "<html>{{NAME}}{{BASE_PATH}}</html>",
    manifest: JSON.stringify({ transport: ["websocket"] }),
    workerBytes: 9,
    ...overrides,
  };
}

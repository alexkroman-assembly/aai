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
export function silenceSteps(): { restore: () => void } {
  const stepStub = stub(_internals, "step", () => {});
  return { restore: () => stepStub.restore() };
}

/** Create a minimal BundleOutput for deploy tests. */
export function makeBundle(overrides?: Partial<BundleOutput>): BundleOutput {
  return {
    worker: "// worker",
    client: "// client",
    manifest: JSON.stringify({ env: { ASSEMBLYAI_API_KEY: "test" } }),
    workerBytes: 9,
    clientBytes: 9,
    ...overrides,
  };
}

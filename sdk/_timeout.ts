// Copyright 2025 the AAI authors. MIT license.
/**
 * Timeout wrapper for promises, used by both worker-side and host-side RPC.
 *
 * @module
 */

import { deadline } from "@std/async/deadline";

/**
 * Wrap a promise with a timeout. Rejects with `Error` if the promise
 * does not settle within `timeoutMs` milliseconds.
 *
 * If `timeoutMs` is `undefined` or `0`, the original promise is returned
 * unchanged.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  if (!timeoutMs) return promise;
  return deadline(promise, timeoutMs).catch((err) => {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(`RPC timed out after ${timeoutMs}ms`);
    }
    throw err;
  });
}

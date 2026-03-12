/** All permissions denied — used for sandboxed agent and code-execution workers. */
export const LOCKED_PERMISSIONS = {
  net: false,
  read: false,
  write: false,
  env: false,
  sys: false,
  run: false,
  ffi: false,
} as const;

/**
 * Typed wrapper for creating Deno Workers with permission options.
 * Deno supports a `deno` option on the Worker constructor but TypeScript
 * types don't include it — this is the single place for the cast.
 */
export function createDenoWorker(
  specifier: string | URL,
  name: string,
  permissions: {
    net: boolean;
    read: boolean;
    write: boolean;
    env: boolean;
    sys: boolean;
    run: boolean;
    ffi: boolean;
  },
): Worker {
  return new (Worker as unknown as new (
    specifier: string | URL,
    options: {
      type: "module";
      name: string;
      deno: { permissions: typeof permissions };
    },
  ) => Worker)(specifier, { type: "module", name, deno: { permissions } });
}

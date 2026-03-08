/**
 * Typed wrapper for creating Deno Workers with permission options.
 *
 * Deno's runtime supports a `deno` option on the Worker constructor for
 * sandboxing permissions, but the TypeScript types don't include it.
 * This helper provides a single place for the type assertion.
 */

type DenoPermissions = {
  net: boolean;
  read: boolean;
  write: boolean;
  env: boolean;
  sys: boolean;
  run: boolean;
  ffi: boolean;
};

type DenoWorkerOptions = {
  type: "module";
  name: string;
  deno: { permissions: DenoPermissions };
};

const DenoWorker = Worker as unknown as new (
  specifier: string | URL,
  options: DenoWorkerOptions,
) => Worker;

export function createDenoWorker(
  specifier: string | URL,
  name: string,
  permissions: DenoPermissions,
): Worker {
  return new DenoWorker(specifier, {
    type: "module",
    name,
    deno: { permissions },
  });
}

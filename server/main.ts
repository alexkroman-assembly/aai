// Copyright 2025 the AAI authors. MIT license.
import * as log from "@std/log";
import { createOrchestrator } from "./orchestrator.ts";
import { createBundleStore, createS3Client } from "./bundle_store_tigris.ts";
import { createKvStore } from "./kv.ts";
import { importScopeKey } from "./scope_token.ts";
import { deriveCredentialKey } from "./credentials.ts";

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    log.error(`FATAL: ${name} must be set`);
    Deno.exit(1);
  }
  return value;
}

const isDev = !Deno.env.get("BUCKET_NAME");

let store;
let kvStore;
let scopeKey;

if (isDev) {
  log.info("DEV MODE — using in-memory stores (no S3/Redis required)");
  const { createTestStore, createTestKvStore } = await import(
    "./_test_utils.ts"
  );
  store = createTestStore();
  kvStore = createTestKvStore();
  scopeKey = await importScopeKey("dev-secret");
} else {
  const bucket = requireEnv("BUCKET_NAME");
  const kvSecret = requireEnv("KV_SCOPE_SECRET");
  const credentialKey = await deriveCredentialKey(kvSecret);
  const s3 = createS3Client();
  store = createBundleStore(s3, { bucket, credentialKey });
  kvStore = createKvStore(
    requireEnv("UPSTASH_REDIS_REST_URL"),
    requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  );
  scopeKey = await importScopeKey(kvSecret);
}

const handler = createOrchestrator({ store, kvStore, scopeKey });

const port = parseInt(Deno.env.get("PORT") ?? "3100");
const abort = new AbortController();
Deno.addSignalListener("SIGTERM", () => {
  log.info("SIGTERM received — draining connections...");
  abort.abort();
});

const server = Deno.serve(
  { port, hostname: "0.0.0.0", signal: abort.signal, onListen: () => {} },
  handler,
);

log.info(`http://localhost:${port}`);

await server.finished;
log.info("Shutdown complete");

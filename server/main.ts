import { createOrchestrator } from "./orchestrator.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import { MemoryBundleStore } from "./bundle_store_memory.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("server");

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

let store: BundleStore;
const bucket = Deno.env.get("BUCKET_NAME");
if (bucket && Deno.env.get("AWS_ENDPOINT_URL_S3")) {
  const { createS3Client, TigrisBundleStore } = await import(
    "./bundle_store_tigris.ts"
  );
  store = new TigrisBundleStore(createS3Client(), bucket);
} else {
  store = new MemoryBundleStore();
}
const { app } = createOrchestrator({ store });

const port = parseInt(Deno.env.get("PORT") ?? "3100");
const server = Deno.serve(
  { port, hostname: "0.0.0.0", onListen: () => {} },
  app.fetch,
);

log.info(`http://localhost:${port}`);

Deno.addSignalListener("SIGTERM", () => {
  log.info("SIGTERM received — draining connections...");
  server.shutdown();
});

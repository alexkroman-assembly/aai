import { createOrchestrator } from "./orchestrator.ts";
import { createS3Client, TigrisBundleStore } from "./bundle_store_tigris.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("server");

try {
  const { load } = await import("@std/dotenv");
  await load({ export: true });
} catch { /* .env not found — fine */ }

const bucket = Deno.env.get("BUCKET_NAME") ?? "local";
let s3;
if (Deno.env.get("AWS_ENDPOINT_URL_S3")) {
  s3 = createS3Client();
} else {
  const { createMemoryS3Client } = await import("./s3_memory.ts");
  s3 = createMemoryS3Client();
  log.info("Using in-memory storage (no S3 configured)");
}
const store = new TigrisBundleStore(s3, bucket);
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

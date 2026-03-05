import type { Hono } from "@hono/hono";
import { compress } from "@hono/hono/compress";
import { cors } from "@hono/hono/cors";
import { HTTPException } from "@hono/hono/http-exception";
import { getLogger } from "./logger.ts";

const log = getLogger("middleware");

export function applyMiddleware(app: Hono): void {
  // Cross-Origin-Isolation headers required for SharedArrayBuffer in capture worklet
  app.use("*", async (c, next) => {
    await next();
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Embedder-Policy", "credentialless");
  });
  app.use("*", cors());
  app.use("*", compress());
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log.error("Unhandled error", { err, path: c.req.path });
    return c.json({ error: "Internal server error" }, 500);
  });
}

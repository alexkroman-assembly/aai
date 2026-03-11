import { type Context, Hono } from "hono";
import { cache } from "hono/cache";
import { compress } from "hono/compress";
import { etag } from "hono/etag";
import { HTTPException } from "hono/http-exception";
import { FAVICON_SVG, renderLandingPage } from "./html.ts";
import { INSTALL_SCRIPT } from "./install.ts";
import { handleDeploy, validateDeployBody } from "./deploy.ts";
import {
  handleAgentHealth,
  handleAgentPage,
  handleStaticFile,
  handleWebSocket,
} from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import { handleTwilioStream, handleTwilioVoice } from "./transport_twilio.ts";
import {
  handleDevSessionWebSocket,
  handleDevWebSocket,
} from "./dev_session.ts";
import { handleKv, validateKvRequest } from "./kv_handler.ts";
import { createMemoryKvStore, type KvStore } from "./kv.ts";
import type { ScopeKey } from "./scope_token.ts";
import { serialize as serializeMetrics, serializeForAgent } from "./metrics.ts";
import type { HonoEnv } from "./hono_env.ts";
import {
  corsMiddleware,
  requireOwnerMiddleware,
  requireScopeTokenMiddleware,
  requireUpgrade,
  securityHeaders,
  slugValidation,
} from "./middleware.ts";

export function createOrchestrator(opts: {
  store: BundleStore;
  kvStore?: KvStore;
  scopeKey: ScopeKey;
}): Deno.ServeHandler {
  const { store } = opts;
  const kvStore = opts.kvStore ?? createMemoryKvStore();
  const scopeKey = opts.scopeKey;

  const slots = new Map<string, AgentSlot>();
  const devSlots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();

  const app = new Hono<HonoEnv>();

  // --- Global middleware ---
  app.use("*", corsMiddleware);
  app.use("*", securityHeaders);
  app.use("*", compress());

  // --- Error handler ---
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error("Unhandled error", { error: err.message, path: c.req.path });
    return c.json({ error: "Internal server error" }, 500);
  });

  // --- Public routes ---
  const serveFavicon = (c: Context<HonoEnv>) =>
    c.body(FAVICON_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      },
    });
  app.get("/favicon.ico", serveFavicon);
  app.get("/favicon.svg", serveFavicon);
  app.get("/install", (c) => c.text(INSTALL_SCRIPT));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/metrics", (c) => {
    c.header("Content-Type", "text/plain; version=0.0.4");
    return c.body(serializeMetrics());
  });
  app.get("/", (c) => c.html(renderLandingPage()));

  // --- Agent routes (require valid slug + inject shared state) ---
  const agent = new Hono<HonoEnv>();
  agent.use("*", slugValidation);
  agent.use("*", async (c, next) => {
    c.set("slots", slots);
    c.set("devSlots", devSlots);
    c.set("sessions", sessions);
    c.set("store", store);
    c.set("scopeKey", scopeKey);
    c.set("kvStore", kvStore);
    await next();
  });

  // Owner-authenticated
  agent.post(
    "/deploy",
    requireOwnerMiddleware(store),
    validateDeployBody,
    handleDeploy,
  );

  // Scope-token-authenticated
  agent.post(
    "/kv",
    requireScopeTokenMiddleware(scopeKey),
    validateKvRequest,
    handleKv,
  );

  // Twilio
  agent.post("/voice", handleTwilioVoice);
  agent.all("/stream", requireUpgrade, handleTwilioStream);

  // Dev mode
  agent.all("/dev", requireUpgrade, handleDevWebSocket);
  agent.all("/dev/websocket", handleDevSessionWebSocket);

  // Agent public endpoints
  agent.get("/metrics", (c) => {
    c.header("Content-Type", "text/plain; version=0.0.4");
    return c.body(serializeForAgent(c.var.slug));
  });
  agent.get("/health", handleAgentHealth);
  agent.all("/websocket", requireUpgrade, handleWebSocket);
  agent.get(
    "/client.js",
    etag(),
    cache({ cacheName: "static", cacheControl: "no-cache" }),
    handleStaticFile,
  );
  agent.get(
    "/client.js.map",
    etag(),
    cache({ cacheName: "static", cacheControl: "no-cache" }),
    handleStaticFile,
  );

  // Agent page
  agent.get("/", handleAgentPage);

  app.route("/:namespace/:slug", agent);

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return (req, info) => app.fetch(req, { ...info });
}

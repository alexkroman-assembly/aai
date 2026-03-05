import { Hono } from "@hono/hono";
import { faviconRoutes, renderLandingPage } from "./html.ts";
import { installRoute } from "./install.ts";
import { applyMiddleware } from "./middleware.ts";
import { createDeployRoute } from "./deploy.ts";
import { createWebSocketRoutes } from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import { createTwilioRoutes } from "./transport_twilio.ts";

export function createOrchestrator(opts: {
  store: BundleStore;
}): { app: Hono } {
  const { store } = opts;

  const slots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();

  const app = new Hono();
  applyMiddleware(app);
  app.route("/", faviconRoutes());
  app.route("/", installRoute());
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      agents: [...slots.values()].map((s) => ({
        slug: s.slug,
        name: s.live?.name ?? s.slug,
        ready: !!s.live,
      })),
    }));
  app.route("/", createDeployRoute({ slots, store }));
  app.route("/", createTwilioRoutes({ slots, store }));
  app.route("/", createWebSocketRoutes({ slots, sessions, store }));

  app.get("/", (c) => c.html(renderLandingPage()));

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return { app };
}

import { handleFavicon, renderLandingPage } from "./html.ts";
import { handleInstall } from "./install.ts";
import { withMiddleware } from "./middleware.ts";
import { handleDeploy } from "./deploy.ts";
import {
  handleAgentHealth,
  handleAgentPage,
  handleAgentRedirect,
  handleStaticFile,
  handleWebSocket,
  type WebSocketContext,
} from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import {
  handleTwilioStream,
  handleTwilioVoice,
  type TwilioContext,
} from "./transport_twilio.ts";

type Handler = (req: Request) => Response | Promise<Response>;

interface Route {
  pattern: URLPattern;
  method?: string;
  handler: (
    req: Request,
    match: URLPatternResult,
  ) => Response | Promise<Response>;
}

export interface App {
  fetch: (req: Request) => Response | Promise<Response>;
  request: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}

export function createOrchestrator(opts: {
  store: BundleStore;
}): { app: App } {
  const { store } = opts;

  const slots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();
  const wsCtx: WebSocketContext = { slots, sessions, store };
  const twilioCtx: TwilioContext = { slots, store };

  const routes: Route[] = [
    // Static routes
    {
      pattern: new URLPattern({ pathname: "/favicon.ico" }),
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/favicon.svg" }),
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/install" }),
      handler: () => handleInstall(),
    },
    {
      pattern: new URLPattern({ pathname: "/health" }),
      handler: () =>
        Response.json({
          status: "ok",
          agents: [...slots.values()].map((s) => ({
            slug: s.slug,
            name: s.live?.name ?? s.slug,
            ready: !!s.live,
          })),
        }),
    },
    // Deploy
    {
      pattern: new URLPattern({ pathname: "/deploy" }),
      method: "POST",
      handler: (req) => handleDeploy(req, { slots, store }),
    },
    // Twilio
    {
      pattern: new URLPattern({ pathname: "/:slug/twilio/voice" }),
      method: "POST",
      handler: (req, m) =>
        handleTwilioVoice(req, m.pathname.groups.slug!, twilioCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug/twilio/stream" }),
      handler: (req, m) =>
        handleTwilioStream(req, m.pathname.groups.slug!, twilioCtx),
    },
    // Agent WebSocket routes
    {
      pattern: new URLPattern({ pathname: "/:slug/health" }),
      handler: (req, m) =>
        handleAgentHealth(req, m.pathname.groups.slug!, wsCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug/websocket" }),
      handler: (req, m) => handleWebSocket(req, m.pathname.groups.slug!, wsCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug/client.js" }),
      handler: (req, m) =>
        handleStaticFile(req, m.pathname.groups.slug!, "client.js", wsCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug/client.js.map" }),
      handler: (req, m) =>
        handleStaticFile(req, m.pathname.groups.slug!, "client.js.map", wsCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug/" }),
      handler: (req, m) => handleAgentPage(req, m.pathname.groups.slug!, wsCtx),
    },
    {
      pattern: new URLPattern({ pathname: "/:slug" }),
      handler: (req, m) =>
        handleAgentRedirect(req, m.pathname.groups.slug!, wsCtx),
    },
    // Landing page
    {
      pattern: new URLPattern({ pathname: "/" }),
      handler: () =>
        new Response(renderLandingPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    },
  ];

  const rawHandler: Handler = (req: Request) => {
    for (const route of routes) {
      if (route.method && req.method !== route.method) continue;
      const match = route.pattern.exec(req.url);
      if (match) return route.handler(req, match);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  };

  const handler = withMiddleware(rawHandler);

  const app: App = {
    fetch: handler,
    request: async (input, init?) => {
      const req = input instanceof Request ? input : new Request(
        typeof input === "string" && !input.startsWith("http")
          ? `http://localhost${input}`
          : input,
        init,
      );
      return await handler(req);
    },
  };

  return { app };
}

import { type Route, route } from "@std/http/unstable-route";
import { handleFavicon, renderLandingPage } from "./html.ts";
import { handleInstall } from "./install.ts";
import { handleDeploy } from "./deploy.ts";
import { requireOwner } from "./auth.ts";
import {
  handleAgentHealth,
  handleAgentPage,
  handleAgentRedirect,
  handleStaticFile,
  handleWebSocket,
} from "./transport_websocket.ts";
import type { AgentSlot } from "./worker_pool.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { Session } from "./session.ts";
import { handleTwilioStream, handleTwilioVoice } from "./transport_twilio.ts";
import type { ServerContext } from "./types.ts";
import {
  handleDevSessionWebSocket,
  handleDevWebSocket,
} from "./dev_session.ts";
import { handleKv } from "./kv_handler.ts";
import { createMemoryKvStore, type KvStore } from "./kv.ts";

type Params = Record<string, string>;

function groups(match: URLPatternResult): Params {
  return (match.pathname.groups ?? {}) as Params;
}

const VALID_SLUG_PART = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/;
const BAD_SLUG = Response.json({ error: "Invalid slug" }, { status: 400 });

function slug(match: URLPatternResult): string | null {
  const p = groups(match);
  if (!VALID_SLUG_PART.test(p.namespace) || !VALID_SLUG_PART.test(p.slug)) {
    return null;
  }
  return `${p.namespace}/${p.slug}`;
}

function withSlug(
  fn: (req: Request, s: string) => Response | Promise<Response>,
): (req: Request, match: URLPatternResult) => Response | Promise<Response> {
  return (req, match) => {
    const s = slug(match);
    if (!s) return BAD_SLUG;
    return fn(req, s);
  };
}

const CORS_HEADERS: [string, string][] = [
  ["Access-Control-Allow-Origin", "*"],
  ["Access-Control-Allow-Methods", "*"],
  ["Access-Control-Allow-Headers", "*"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Embedder-Policy", "credentialless"],
];

function withCors(
  inner: Deno.ServeHandler,
): Deno.ServeHandler {
  return async (req, info) => {
    if (req.method === "OPTIONS") {
      const res = new Response(null, { status: 204 });
      for (const [k, v] of CORS_HEADERS) res.headers.set(k, v);
      return res;
    }
    const res = await inner(req, info);
    for (const [k, v] of CORS_HEADERS) res.headers.set(k, v);
    return res;
  };
}

export function createOrchestrator(opts: {
  store: BundleStore;
  kvStore?: KvStore;
  scopeKey: CryptoKey;
}): Deno.ServeHandler {
  const { store } = opts;

  const kvStore = opts.kvStore ?? createMemoryKvStore();
  const scopeKey = opts.scopeKey;

  const slots = new Map<string, AgentSlot>();
  const devSlots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();
  const ctx: ServerContext = { slots, devSlots, sessions, store, scopeKey };

  const routes: Route[] = [
    {
      pattern: new URLPattern({ pathname: "/favicon.ico" }),
      method: ["GET"],
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/favicon.svg" }),
      method: ["GET"],
      handler: () => handleFavicon(),
    },
    {
      pattern: new URLPattern({ pathname: "/install" }),
      method: ["GET"],
      handler: (req) => handleInstall(req),
    },
    {
      pattern: new URLPattern({ pathname: "/health" }),
      method: ["GET"],
      handler: () => Response.json({ status: "ok" }),
    },

    {
      pattern: new URLPattern({ pathname: "/kv" }),
      method: ["POST"],
      handler: (req) => handleKv(req, { kvStore, scopeKey }),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/deploy" }),
      method: ["POST"],
      handler: withSlug(async (req, s) => {
        const owner = await requireOwner(req, s, ctx);
        if (owner instanceof Response) return owner;
        return handleDeploy(req, s, owner, ctx);
      }),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/voice" }),
      method: ["POST"],
      handler: withSlug((req, s) => handleTwilioVoice(req, s, ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/stream" }),
      handler: withSlug((req, s) => handleTwilioStream(req, s, ctx)),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/dev" }),
      handler: withSlug((req, s) => handleDevWebSocket(req, s, ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/dev/websocket" }),
      handler: withSlug((req, s) => handleDevSessionWebSocket(req, s, ctx)),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/health" }),
      method: ["GET"],
      handler: withSlug((req, s) => handleAgentHealth(req, s, ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/websocket" }),
      handler: withSlug((req, s) => handleWebSocket(req, s, ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js" }),
      method: ["GET"],
      handler: withSlug((req, s) => handleStaticFile(req, s, "client.js", ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js.map" }),
      method: ["GET"],
      handler: withSlug((req, s) =>
        handleStaticFile(req, s, "client.js.map", ctx)
      ),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/" }),
      method: ["GET"],
      handler: withSlug((req, s) => handleAgentPage(req, s, ctx)),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug" }),
      method: ["GET"],
      handler: withSlug((req, s) => handleAgentRedirect(req, s, ctx)),
    },

    {
      pattern: new URLPattern({ pathname: "/" }),
      method: ["GET"],
      handler: () =>
        new Response(renderLandingPage(), {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        }),
    },
  ];

  const handler = withCors(
    route(routes, () => Response.json({ error: "Not found" }, { status: 404 })),
  );

  return handler;
}

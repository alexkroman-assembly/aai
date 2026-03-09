import { type Route, route } from "@std/http/unstable-route";
import { handleFavicon, renderLandingPage } from "./html.ts";
import { handleInstall } from "./install.ts";
import { handleDeploy } from "./deploy.ts";
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
import { handleDevWebSocket } from "./dev_session.ts";
import { handleKv } from "./kv_handler.ts";
import { createMemoryKvStore, type KvStore } from "./kv.ts";
import { createTokenSigner, type TokenSigner } from "./scope_token.ts";

type Params = Record<string, string>;

function groups(match: URLPatternResult): Params {
  return (match.pathname.groups ?? {}) as Params;
}

function slug(match: URLPatternResult): string {
  const p = groups(match);
  return `${p.namespace}/${p.slug}`;
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

export async function createOrchestrator(opts: {
  store: BundleStore;
  kvStore?: KvStore;
  tokenSigner?: TokenSigner;
}): Promise<{ handler: Deno.ServeHandler; tokenSigner: TokenSigner }> {
  const { store } = opts;

  const kvStore = opts.kvStore ?? createMemoryKvStore();
  const tokenSigner = opts.tokenSigner ??
    await createTokenSigner(
      Deno.env.get("UPSTASH_REDIS_REST_TOKEN") ?? "dev-kv-signing-key",
    );

  const slots = new Map<string, AgentSlot>();
  const sessions = new Map<string, Session>();
  const ctx: ServerContext = { slots, sessions, store, tokenSigner };

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
      handler: () =>
        Response.json({
          status: "ok",
          agents: [...slots.values()].map((s) => ({
            slug: s.slug,
            name: s.name ?? s.slug,
            ready: !!s.worker,
          })),
        }),
    },

    {
      pattern: new URLPattern({ pathname: "/kv" }),
      method: ["POST"],
      handler: (req) => handleKv(req, { kvStore, tokenSigner }),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/deploy" }),
      method: ["POST"],
      handler: (req, match) =>
        handleDeploy(req, groups(match), { slots, store, tokenSigner }),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/voice" }),
      method: ["POST"],
      handler: (req, match) => handleTwilioVoice(req, slug(match), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/twilio/stream" }),
      handler: (req, match) => handleTwilioStream(req, slug(match), ctx),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/dev" }),
      handler: (req, match) => handleDevWebSocket(req, slug(match), ctx),
    },

    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/health" }),
      method: ["GET"],
      handler: (req, match) => handleAgentHealth(req, slug(match), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/websocket" }),
      handler: (req, match) => handleWebSocket(req, slug(match), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js" }),
      method: ["GET"],
      handler: (req, match) =>
        handleStaticFile(req, slug(match), "client.js", ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/client.js.map" }),
      method: ["GET"],
      handler: (req, match) =>
        handleStaticFile(req, slug(match), "client.js.map", ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug/" }),
      method: ["GET"],
      handler: (req, match) => handleAgentPage(req, slug(match), ctx),
    },
    {
      pattern: new URLPattern({ pathname: "/:namespace/:slug" }),
      method: ["GET"],
      handler: (req, match) => handleAgentRedirect(req, slug(match), ctx),
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

  return { handler, tokenSigner };
}

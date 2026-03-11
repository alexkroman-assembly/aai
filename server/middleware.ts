import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./hono_env.ts";
import { claimNamespace, verifyOwner } from "./auth.ts";
import { type ScopeKey, verifyScopeToken } from "./scope_token.ts";
import type { BundleStore } from "./bundle_store_tigris.ts";

const VALID_SLUG_PART = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/;

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  return c.req.header("Authorization")?.slice(7) || null;
}

export const corsMiddleware = cors({
  origin: "*",
  allowMethods: ["*"],
  allowHeaders: ["*"],
});

export const securityHeaders = secureHeaders({
  crossOriginOpenerPolicy: "same-origin",
  crossOriginEmbedderPolicy: "credentialless",
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  referrerPolicy: false,
  strictTransportSecurity: false,
  xContentTypeOptions: false,
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xFrameOptions: false,
  xPermittedCrossDomainPolicies: false,
  xXssProtection: false,
});

export const slugValidation = createMiddleware<HonoEnv>(async (c, next) => {
  const ns = c.req.param("namespace") ?? "";
  const slug = c.req.param("slug") ?? "";
  if (!VALID_SLUG_PART.test(ns) || !VALID_SLUG_PART.test(slug)) {
    throw new HTTPException(400, { message: "Invalid slug" });
  }
  c.set("slug", `${ns}/${slug}`);
  await next();
});

export function requireOwnerMiddleware(store: BundleStore) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const apiKey = bearerToken(c);
    if (!apiKey) {
      throw new HTTPException(401, {
        message: "Missing Authorization header (Bearer <API_KEY>)",
      });
    }
    const slug = c.var.slug;
    const namespace = slug.split("/")[0];

    const ownerHash = await verifyOwner(apiKey, namespace, store);
    if (!ownerHash) {
      throw new HTTPException(403, {
        message: `Namespace "${namespace}" is owned by another user.`,
      });
    }

    const existing = await store.getNamespaceOwner(namespace);
    if (!existing) await claimNamespace(namespace, ownerHash, store);

    c.set("ownerHash", ownerHash);
    await next();
  });
}

export const requireUpgrade = createMiddleware<HonoEnv>(async (c, next) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(400, { message: "Expected WebSocket upgrade" });
  }
  await next();
});

export function requireScopeTokenMiddleware(scopeKey: ScopeKey) {
  return createMiddleware<HonoEnv>(async (c, next) => {
    const token = bearerToken(c);
    if (!token) {
      throw new HTTPException(401, { message: "Missing Authorization header" });
    }

    const scope = await verifyScopeToken(scopeKey, token);
    if (!scope) {
      throw new HTTPException(403, {
        message: "Invalid or tampered scope token",
      });
    }

    c.set("scope", scope);
    await next();
  });
}

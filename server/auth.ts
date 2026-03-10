import { encodeHex } from "@std/encoding/hex";
import type { BundleStore } from "./bundle_store_tigris.ts";
import type { ServerContext } from "./types.ts";

export async function hashApiKey(apiKey: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(new Uint8Array(hashBuffer));
}

/** Verify an API key against namespace ownership. Does not claim. */
export async function verifyOwner(
  apiKey: string,
  namespace: string,
  store: BundleStore,
): Promise<string | null> {
  const ownerHash = await hashApiKey(apiKey);
  const existing = await store.getNamespaceOwner(namespace);
  if (!existing) return ownerHash; // unclaimed — caller decides whether to claim
  return existing === ownerHash ? ownerHash : null;
}

/** Claim a namespace for an owner hash. */
export async function claimNamespace(
  namespace: string,
  ownerHash: string,
  store: BundleStore,
): Promise<void> {
  await store.putNamespaceOwner(namespace, ownerHash);
}

/**
 * Extract Bearer token, verify namespace ownership, and claim if unclaimed.
 * Returns the owner hash on success, or a ready-to-return error Response.
 */
export async function requireOwner(
  req: Request,
  slug: string,
  ctx: ServerContext,
): Promise<string | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { error: "Missing Authorization header (Bearer <API_KEY>)" },
      { status: 401 },
    );
  }
  const apiKey = authHeader.slice(7);
  const namespace = slug.split("/")[0];

  const ownerHash = await verifyOwner(apiKey, namespace, ctx.store);
  if (!ownerHash) {
    return Response.json(
      { error: `Namespace "${namespace}" is owned by another user.` },
      { status: 403 },
    );
  }

  const existing = await ctx.store.getNamespaceOwner(namespace);
  if (!existing) await claimNamespace(namespace, ownerHash, ctx.store);

  return ownerHash;
}

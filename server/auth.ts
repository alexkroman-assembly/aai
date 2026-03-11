import { encodeHex } from "@std/encoding/hex";
import type { BundleStore } from "./bundle_store_tigris.ts";

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

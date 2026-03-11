/**
 * Scope tokens are HS256 JWTs encoding agent ownership.
 * Uses jose for signing and verification.
 */

import { jwtVerify, SignJWT } from "jose";

export type AgentScope = {
  ownerHash: string;
  slug: string;
};

/** Opaque key type for scope token operations. */
export type ScopeKey = Uint8Array;

const enc = new TextEncoder();

export function importScopeKey(secret: string): Promise<ScopeKey> {
  return Promise.resolve(enc.encode(secret));
}

export async function signScopeToken(
  key: ScopeKey,
  scope: AgentScope,
): Promise<string> {
  return await new SignJWT({ sub: scope.ownerHash, scope: scope.slug })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(key);
}

export async function verifyScopeToken(
  key: ScopeKey,
  token: string,
): Promise<AgentScope | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const scope = payload.scope;
    if (
      typeof sub !== "string" || typeof scope !== "string" || !sub || !scope
    ) {
      return null;
    }
    return { ownerHash: sub, slug: scope };
  } catch {
    return null;
  }
}

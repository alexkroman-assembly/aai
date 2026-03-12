/**
 * Scope tokens are HS256 JWTs encoding agent ownership.
 * Uses jose for signing and verification.
 */

import { jwtVerify, SignJWT } from "jose";

export type AgentScope = {
  accountId: string;
  slug: string;
};

/** Opaque key type for scope token operations. */
export type ScopeKey = Uint8Array;

const enc = new TextEncoder();

export async function importScopeKey(secret: string): Promise<ScopeKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("aai-scope-token"),
      info: enc.encode("scope-signing"),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

export async function signScopeToken(
  key: ScopeKey,
  scope: AgentScope,
): Promise<string> {
  return await new SignJWT({ sub: scope.accountId, scope: scope.slug })
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
    return { accountId: sub, slug: scope };
  } catch {
    return null;
  }
}

/**
 * Scope tokens are standard HS256 JWTs encoding agent ownership.
 * Pure Web Crypto + @std/crypto for timing-safe comparison.
 */

import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { timingSafeEqual } from "@std/crypto/timing-safe-equal";

export type AgentScope = {
  ownerHash: string;
  slug: string;
};

const enc = new TextEncoder();

function encodeSegment(obj: unknown): string {
  return encodeBase64Url(enc.encode(JSON.stringify(obj)));
}

const HEADER = encodeSegment({ alg: "HS256", typ: "JWT" });

async function hmacSign(key: CryptoKey, data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function importScopeKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signScopeToken(
  key: CryptoKey,
  scope: AgentScope,
): Promise<string> {
  const payload = encodeSegment({ sub: scope.ownerHash, scope: scope.slug });
  const input = `${HEADER}.${payload}`;
  return `${input}.${encodeBase64Url(await hmacSign(key, input))}`;
}

export async function verifyScopeToken(
  key: CryptoKey,
  token: string,
): Promise<AgentScope | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, sig] = parts;
  const input = `${header}.${payload}`;

  let sigBytes: Uint8Array;
  try {
    sigBytes = decodeBase64Url(sig);
  } catch {
    return null;
  }

  const expected = await hmacSign(key, input);
  if (
    sigBytes.length !== expected.length ||
    !timingSafeEqual(sigBytes, expected)
  ) {
    return null;
  }

  try {
    const json = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    );
    if (
      typeof json.sub !== "string" || typeof json.scope !== "string" ||
      !json.sub || !json.scope
    ) {
      return null;
    }
    return { ownerHash: json.sub, slug: json.scope };
  } catch {
    return null;
  }
}

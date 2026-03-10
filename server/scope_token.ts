/**
 * Scope tokens are standard HS256 JWTs encoding agent ownership.
 * Hand-rolled on Web Crypto + @std/crypto for timing-safe comparison.
 */

import { timingSafeEqual } from "@std/crypto/timing-safe-equal";

export type AgentScope = {
  ownerHash: string;
  slug: string;
};

export type TokenSigner = {
  sign(scope: AgentScope): Promise<string>;
  verify(token: string): Promise<AgentScope | null>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function encodeSegment(obj: unknown): string {
  return base64url(encoder.encode(JSON.stringify(obj)));
}

const HEADER = encodeSegment({ alg: "HS256", typ: "JWT" });

async function hmacSign(key: CryptoKey, data: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

export async function createTokenSigner(secret: string): Promise<TokenSigner> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return {
    async sign(scope) {
      const payload = encodeSegment({ sub: scope.ownerHash, scope: scope.slug });
      const input = `${HEADER}.${payload}`;
      const sig = base64url(await hmacSign(key, input));
      return `${input}.${sig}`;
    },

    async verify(token) {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const [header, payload, sig] = parts;
      const input = `${header}.${payload}`;

      let sigBytes: Uint8Array;
      try {
        sigBytes = base64urlDecode(sig);
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
        const json = JSON.parse(decoder.decode(base64urlDecode(payload)));
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
    },
  };
}

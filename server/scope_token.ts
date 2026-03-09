import { decodeBase64, encodeBase64 } from "@std/encoding/base64";

export type AgentScope = {
  ownerHash: string;
  slug: string;
};

export type TokenSigner = {
  sign(scope: AgentScope): Promise<string>;
  verify(token: string): Promise<AgentScope | null>;
};

export async function createTokenSigner(secret: string): Promise<TokenSigner> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return {
    async sign(scope) {
      const payload = JSON.stringify({
        o: scope.ownerHash,
        s: scope.slug,
      });
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
      );
      const sigB64 = encodeBase64(new Uint8Array(sig));
      return encodeBase64(new TextEncoder().encode(`${payload}.${sigB64}`));
    },

    async verify(token) {
      let raw: string;
      try {
        raw = new TextDecoder().decode(decodeBase64(token));
      } catch {
        return null;
      }

      const dotIdx = raw.lastIndexOf(".");
      if (dotIdx === -1) return null;

      const payload = raw.slice(0, dotIdx);
      const sigB64 = raw.slice(dotIdx + 1);

      let sig: Uint8Array;
      try {
        sig = decodeBase64(sigB64);
      } catch {
        return null;
      }

      const valid = await crypto.subtle.verify(
        "HMAC",
        key,
        new Uint8Array(sig).buffer,
        new TextEncoder().encode(payload),
      );
      if (!valid) return null;

      try {
        const parsed = JSON.parse(payload);
        if (
          typeof parsed.o !== "string" || typeof parsed.s !== "string" ||
          !parsed.o || !parsed.s
        ) {
          return null;
        }
        return { ownerHash: parsed.o, slug: parsed.s };
      } catch {
        return null;
      }
    },
  };
}

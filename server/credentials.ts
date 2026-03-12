/**
 * Encrypts and decrypts agent env vars at rest using jose JWE (A256GCM + dir).
 * The encryption key is derived from KV_SCOPE_SECRET via HKDF.
 */

import { compactDecrypt, CompactEncrypt } from "jose";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Opaque type for the credential encryption key (raw 256-bit bytes). */
export type CredentialKey = Uint8Array;

/** Derive a 256-bit key from the scope secret via HKDF-SHA256. */
export async function deriveCredentialKey(
  secret: string,
): Promise<CredentialKey> {
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
      salt: enc.encode("aai-credentials"),
      info: enc.encode("env-encryption"),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** Encrypt an env record into a compact JWE string. */
export async function encryptEnv(
  key: CredentialKey,
  env: Record<string, string>,
): Promise<string> {
  return await new CompactEncrypt(enc.encode(JSON.stringify(env)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
}

/** Decrypt a compact JWE string back into an env record. */
export async function decryptEnv(
  key: CredentialKey,
  jwe: string,
): Promise<Record<string, string>> {
  const { plaintext } = await compactDecrypt(jwe, key);
  return JSON.parse(dec.decode(plaintext));
}

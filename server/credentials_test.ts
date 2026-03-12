import { expect } from "@std/expect";
import { decryptEnv, deriveCredentialKey, encryptEnv } from "./credentials.ts";

Deno.test("credentials", async (t) => {
  await t.step("encrypt and decrypt round-trip", async () => {
    const key = await deriveCredentialKey("test-secret");
    const env = { ASSEMBLYAI_API_KEY: "sk-123", MY_SECRET: "hunter2" };
    const jwe = await encryptEnv(key, env);
    expect(typeof jwe).toBe("string");
    expect(jwe).not.toContain("sk-123");
    expect(await decryptEnv(key, jwe)).toEqual(env);
  });

  await t.step("different secrets cannot decrypt", async () => {
    const key1 = await deriveCredentialKey("secret-a");
    const key2 = await deriveCredentialKey("secret-b");
    const jwe = await encryptEnv(key1, { KEY: "val" });
    await expect(decryptEnv(key2, jwe)).rejects.toThrow();
  });

  await t.step("empty env round-trips", async () => {
    const key = await deriveCredentialKey("test-secret");
    const jwe = await encryptEnv(key, {});
    expect(await decryptEnv(key, jwe)).toEqual({});
  });

  await t.step("same input produces different JWEs (unique IVs)", async () => {
    const key = await deriveCredentialKey("test-secret");
    const env = { KEY: "value" };
    const jwe1 = await encryptEnv(key, env);
    const jwe2 = await encryptEnv(key, env);
    expect(jwe1).not.toBe(jwe2);
  });
});

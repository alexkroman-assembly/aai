import { expect } from "@std/expect";
import {
  importScopeKey,
  signScopeToken,
  verifyScopeToken,
} from "./scope_token.ts";

Deno.test("scope tokens", async (t) => {
  await t.step("sign and verify round-trip", async () => {
    const key = await importScopeKey("test-secret");
    const scope = { ownerHash: "owner123", slug: "my-agent" };
    const token = await signScopeToken(key, scope);
    expect(await verifyScopeToken(key, token)).toEqual(scope);
  });

  await t.step("verify returns null for tampered token", async () => {
    const key = await importScopeKey("test-secret");
    const scope = { ownerHash: "owner123", slug: "my-agent" };
    const token = await signScopeToken(key, scope);
    const tampered = token.slice(0, -2) + "XX";
    expect(await verifyScopeToken(key, tampered)).toBeNull();
  });

  await t.step("verify returns null for garbage input", async () => {
    const key = await importScopeKey("test-secret");
    expect(await verifyScopeToken(key, "not-base64!!!")).toBeNull();
  });

  await t.step("verify returns null for empty string", async () => {
    const key = await importScopeKey("test-secret");
    expect(await verifyScopeToken(key, "")).toBeNull();
  });

  await t.step("different secrets produce different tokens", async () => {
    const key1 = await importScopeKey("secret-a");
    const key2 = await importScopeKey("secret-b");
    const scope = { ownerHash: "owner", slug: "agent" };
    expect(await signScopeToken(key1, scope)).not.toBe(
      await signScopeToken(key2, scope),
    );
  });

  await t.step("token from different secret fails verification", async () => {
    const key1 = await importScopeKey("secret-a");
    const key2 = await importScopeKey("secret-b");
    const token = await signScopeToken(key1, { ownerHash: "o", slug: "s" });
    expect(await verifyScopeToken(key2, token)).toBeNull();
  });
});

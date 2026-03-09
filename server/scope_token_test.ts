import { expect } from "@std/expect";
import { createTokenSigner } from "./scope_token.ts";

Deno.test("createTokenSigner", async (t) => {
  await t.step("sign and verify round-trip", async () => {
    const signer = await createTokenSigner("test-secret");
    const scope = { ownerHash: "owner123", slug: "my-agent" };
    const token = await signer.sign(scope);
    const verified = await signer.verify(token);
    expect(verified).toEqual(scope);
  });

  await t.step("verify returns null for tampered token", async () => {
    const signer = await createTokenSigner("test-secret");
    const scope = { ownerHash: "owner123", slug: "my-agent" };
    const token = await signer.sign(scope);
    // Tamper with the token
    const tampered = token.slice(0, -2) + "XX";
    const verified = await signer.verify(tampered);
    expect(verified).toBeNull();
  });

  await t.step("verify returns null for garbage input", async () => {
    const signer = await createTokenSigner("test-secret");
    expect(await signer.verify("not-base64!!!")).toBeNull();
  });

  await t.step("verify returns null for empty string", async () => {
    const signer = await createTokenSigner("test-secret");
    expect(await signer.verify("")).toBeNull();
  });

  await t.step("different secrets produce different tokens", async () => {
    const signer1 = await createTokenSigner("secret-a");
    const signer2 = await createTokenSigner("secret-b");
    const scope = { ownerHash: "owner", slug: "agent" };
    const token1 = await signer1.sign(scope);
    const token2 = await signer2.sign(scope);
    expect(token1).not.toBe(token2);
  });

  await t.step("token from different secret fails verification", async () => {
    const signer1 = await createTokenSigner("secret-a");
    const signer2 = await createTokenSigner("secret-b");
    const token = await signer1.sign({ ownerHash: "o", slug: "s" });
    expect(await signer2.verify(token)).toBeNull();
  });
});

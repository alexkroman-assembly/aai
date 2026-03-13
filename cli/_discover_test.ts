// Copyright 2025 the AAI authors. MIT license.
import { assertMatch, assertStrictEquals } from "@std/assert";
import { DEFAULT_SERVER, generateSlug } from "./_discover.ts";

Deno.test("generateSlug", async (t) => {
  await t.step("returns a lowercase hyphenated string", () => {
    const slug = generateSlug();
    assertMatch(slug, /^[a-z]+-[a-z]+-[a-z]+$/);
  });

  await t.step("generates different slugs on each call", () => {
    const slugs = new Set(Array.from({ length: 10 }, () => generateSlug()));
    // With 10 calls we should get at least 2 unique values
    assertStrictEquals(slugs.size > 1, true);
  });
});

Deno.test("DEFAULT_SERVER", () => {
  assertStrictEquals(DEFAULT_SERVER, "https://aai-agent.fly.dev");
});

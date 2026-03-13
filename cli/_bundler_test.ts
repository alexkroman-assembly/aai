// Copyright 2025 the AAI authors. MIT license.
import { assertInstanceOf, assertStrictEquals } from "@std/assert";
import { _internals } from "./_bundler.ts";

const { BundleError } = _internals;

Deno.test("BundleError: creates error with BundleError name", () => {
  const err = new BundleError("something went wrong");
  assertInstanceOf(err, Error);
  assertInstanceOf(err, BundleError);
  assertStrictEquals(err.name, "BundleError");
  assertStrictEquals(err.message, "something went wrong");
});

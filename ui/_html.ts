import htm from "htm";
import { h } from "preact";
import type { VNode } from "preact";

// htm.bind() returns a tagged template function, but the TS declarations
// don't model the bind-to-tagged-template transform. We cast to the
// correct tagged-template signature.
// deno-lint-ignore no-explicit-any
export const html: (strings: TemplateStringsArray, ...values: any[]) => VNode =
  // deno-lint-ignore no-explicit-any
  (htm as any).bind(h);

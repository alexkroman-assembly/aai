import { validator } from "hono/validator";
import type { z } from "zod";

/** Hono JSON validator backed by a Zod schema. Returns 400 on failure. */
export function jsonValidator<T>(schema: z.ZodType<T>, errorPrefix: string) {
  return validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: `${errorPrefix}: ${parsed.error.message}` }, 400);
    }
    return parsed.data;
  });
}

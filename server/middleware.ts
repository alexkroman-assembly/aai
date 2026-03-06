import { getLogger } from "./logger.ts";

const log = getLogger("middleware");

type Handler = (req: Request) => Response | Promise<Response>;

export function withMiddleware(handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    try {
      const res = await handler(req);
      // Cross-Origin-Isolation headers required for SharedArrayBuffer in capture worklet
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      // CORS
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization",
      );
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch (err: unknown) {
      log.error("Unhandled error", { err, path: new URL(req.url).pathname });
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

/**
 * Typed wrapper for creating WebSockets with custom headers.
 *
 * Deno's runtime supports a `{ headers }` option in the WebSocket constructor,
 * but the standard TypeScript types only allow `string | string[]` as the
 * second argument. This helper provides a single place for the type assertion.
 */

export function createWebSocketWithHeaders(
  url: string | URL,
  headers: Record<string, string>,
): WebSocket {
  const WS = WebSocket as unknown as new (
    url: string | URL,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new WS(url, { headers });
}

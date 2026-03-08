export function httpError(status: number, statusText: string): Error {
  const err = new Error(`${status} ${statusText}`);
  err.name = "HttpError";
  (err as Error & { status: number }).status = status;
  return err;
}

export async function fetchJSON<T = unknown>(
  url: string,
  init?: RequestInit & { fetch?: typeof globalThis.fetch },
): Promise<T> {
  const { fetch: fetchFn = globalThis.fetch, ...rest } = init ?? {};
  const resp = await fetchFn(url, rest);
  if (!resp.ok) throw httpError(resp.status, resp.statusText);
  return resp.json();
}

export class HttpError extends Error {
  constructor(public status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.name = "HttpError";
  }
}

export async function fetchJSON(
  url: string,
  init?: RequestInit & { fetch?: typeof globalThis.fetch },
): Promise<unknown> {
  const { fetch: fetchFn = globalThis.fetch, ...rest } = init ?? {};
  const resp = await fetchFn(url, rest);
  if (!resp.ok) throw new HttpError(resp.status, resp.statusText);
  return resp.json();
}

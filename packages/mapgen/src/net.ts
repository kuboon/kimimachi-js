/** HTTP abstraction: the library never touches the network directly, callers inject a Fetcher. */

/** Fetch a URL and return its bytes, or null for 404. Wrap it with a cache / User-Agent as needed. */
export type Fetcher = (url: string) => Promise<Uint8Array | null>;

/** Default fetcher built on the global `fetch`. */
export const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};

export function withParams(url: string, params?: Record<string, string | number>): string {
  if (!params) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export async function fetchJson<T = unknown>(
  fetcher: Fetcher,
  url: string,
  params?: Record<string, string | number>,
): Promise<T | null> {
  const data = await fetcher(withParams(url, params));
  return data && data.length ? JSON.parse(new TextDecoder().decode(data)) as T : null;
}

/** Run fetcher over urls with a concurrency limit, keeping order. */
export async function fetchMany(
  fetcher: Fetcher,
  urls: string[],
  workers = 8,
  /** treat a failed request as a missing tile (null) instead of failing the whole batch */
  tolerant = false,
): Promise<(Uint8Array | null)[]> {
  const out: (Uint8Array | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        out[i] = tolerant ? await fetcher(urls[i]).catch(() => null) : await fetcher(urls[i]);
      }
    }),
  );
  return out;
}

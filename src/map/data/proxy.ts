// Client-side entry point for the `proxy-fetch` edge function.
//
// Only APIs that need an identifying User-Agent, secrets, server-side caching or
// response slimming go through here (MET Norway, NOAA). Tiles and place names are
// CORS-clean and are fetched directly. To add a host, extend ALLOWED_HOSTS in
// supabase/functions/proxy-fetch/index.ts.

export class ProxyError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ProxyError";
    this.status = status;
    this.code = code;
  }
}

export interface ProxyResult<T> {
  data: T;
  /** Value of the X-Proxy-Cache header: HIT, MISS or REVALIDATED (null if missing). */
  cache: string | null;
  /** Response size in bytes as delivered by the proxy. */
  bytes: number;
}

function supabaseEnv(): { url: string; key: string } {
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (typeof url !== "string" || typeof key !== "string") {
    throw new ProxyError("Supabase environment variables are missing", 0, "env");
  }
  return { url: url.replace(/\/$/, ""), key };
}

/** Full URL of the proxy endpoint for a given upstream URL. */
export function proxiedUrl(upstreamUrl: string): string {
  const { url } = supabaseEnv();
  return `${url}/functions/v1/proxy-fetch?url=${encodeURIComponent(upstreamUrl)}`;
}

/** Fetch JSON from an allowlisted upstream through the proxy. Client-side only. */
export async function proxyFetchJson<T>(
  upstreamUrl: string,
  init: RequestInit = {},
): Promise<ProxyResult<T>> {
  if (typeof window === "undefined") {
    throw new ProxyError("proxyFetchJson is client-side only", 0, "ssr");
  }
  const { key } = supabaseEnv();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Accept", "application/json");

  const response = await fetch(proxiedUrl(upstreamUrl), { ...init, method: "GET", headers });
  const buffer = await response.arrayBuffer();

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = JSON.parse(new TextDecoder().decode(buffer)) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ProxyError(
      `proxy-fetch ${response.status}${code ? ` (${code})` : ""}`,
      response.status,
      code,
    );
  }

  const data = JSON.parse(new TextDecoder().decode(buffer)) as T;
  return { data, cache: response.headers.get("X-Proxy-Cache"), bytes: buffer.byteLength };
}

// proxy-fetch — read-only GET proxy for external APIs that need an identifying
// User-Agent, server-side caching or response slimming (MET Norway, NOAA).
//
// Tiles and place-name lookups are CORS-clean and are fetched directly by the
// browser; they do NOT go through here.
//
// Security model: exact hostname allowlist, https only, GET only, per-IP rate
// limit. verify_jwt is off (no auth yet) — the allowlist is the boundary.
// Every call writes one usage_events row (cost metering) with the service role.

import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Configuration

interface HostRule {
  /** default cache TTL in seconds */
  ttl: number;
}

const ALLOWED_HOSTS: Record<string, HostRule> = {
  "api.met.no": { ttl: 3600 },
  "services.swpc.noaa.gov": { ttl: 300 },
};

const RATE_LIMIT_PER_MINUTE = 120;
const MAX_CACHE_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 15_000;

const CONTACT = Deno.env.get("HIMINROND_CONTACT") ?? "dev; no contact set";
const USER_AGENT = `Himinrond/0.1 (${CONTACT})`;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "X-Proxy-Cache, Cache-Control",
};

// ---------------------------------------------------------------------------
// In-memory cache (survives between invocations while the isolate is warm)

interface CacheEntry {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
  lastModified?: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  // refresh LRU position
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: CacheEntry): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

// ---------------------------------------------------------------------------
// Rate limit (sliding one-minute window per client IP)

const hits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const windowStart = now - 60_000;
  const list = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // crude memory guard
  return list.length > RATE_LIMIT_PER_MINUTE;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Helpers

type CacheStatus = "HIT" | "MISS" | "REVALIDATED";

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
  });
}

function bodyResponse(entry: CacheEntry, status: CacheStatus, now: number): Response {
  const maxAge = Math.max(0, Math.floor((entry.expiresAt - now) / 1000));
  return new Response(entry.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": entry.contentType,
      "Cache-Control": `public, max-age=${maxAge}`,
      "X-Proxy-Cache": status,
    },
  });
}

async function readTargetUrl(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("url");
  if (fromQuery) return fromQuery;
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { url?: unknown };
      if (typeof body.url === "string") return body.url;
    } catch {
      return null;
    }
  }
  return null;
}

/** NOAA OVATION: keep only points north of 45° N. Same JSON shape. */
function slimOvationNorth(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const text = new TextDecoder().decode(raw);
  const data = JSON.parse(text) as Record<string, unknown> & { coordinates?: unknown };
  const coords = Array.isArray(data.coordinates) ? (data.coordinates as unknown[]) : [];
  const kept = coords.filter((c) => Array.isArray(c) && typeof c[1] === "number" && c[1] >= 45);
  const slim = { ...data, coordinates: kept };
  const encoded = new TextEncoder().encode(JSON.stringify(slim));
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  out.set(encoded);
  return out;
}

function computeExpiry(hostRule: HostRule, upstream: Headers, now: number): number {
  let expiresAt = now + hostRule.ttl * 1000;
  const expires = upstream.get("expires");
  if (expires) {
    const t = Date.parse(expires);
    if (!Number.isNaN(t) && t > expiresAt) expiresAt = t;
  }
  return expiresAt;
}

// ---------------------------------------------------------------------------
// Metering (never blocks or breaks the response)

interface MeterInput {
  host: string;
  cache: CacheStatus | "RATE_LIMITED" | "UPSTREAM_ERROR";
  status: number;
  authHeader: string | null;
}

async function meter(input: MeterInput): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let userId: string | null = null;
    if (input.authHeader?.startsWith("Bearer ")) {
      const token = input.authHeader.slice("Bearer ".length);
      const { data } = await admin.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    await admin.from("usage_events").insert({
      user_id: userId,
      kind: "edge_call",
      quantity: 1,
      meta: { fn: "proxy-fetch", host: input.host, cache: input.cache, status: input.status },
    });
  } catch (error) {
    console.error("[proxy-fetch] metering failed:", error instanceof Error ? error.message : error);
  }
}

function schedule(promise: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else void promise;
}

// ---------------------------------------------------------------------------
// Handler

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const now = Date.now();
  const authHeader = req.headers.get("authorization");

  const targetRaw = await readTargetUrl(req);
  if (!targetRaw) return json(400, { error: "missing_url" });

  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    return json(400, { error: "invalid_url" });
  }

  const rule = ALLOWED_HOSTS[target.hostname];
  if (target.protocol !== "https:" || !rule) {
    return json(403, { error: "host_not_allowed", host: target.hostname });
  }

  if (rateLimited(clientIp(req), now)) {
    schedule(meter({ host: target.hostname, cache: "RATE_LIMITED", status: 429, authHeader }));
    return json(429, { error: "rate_limited" }, { "Retry-After": "60" });
  }

  // Slimming is a proxy-level option; strip it before calling upstream.
  const slim = target.searchParams.get("slim");
  target.searchParams.delete("slim");
  const upstreamUrl = target.toString();
  const cacheKey = slim ? `${upstreamUrl}#slim=${slim}` : upstreamUrl;

  const cached = cacheGet(cacheKey);
  if (cached && cached.expiresAt > now) {
    schedule(meter({ host: target.hostname, cache: "HIT", status: 200, authHeader }));
    return bodyResponse(cached, "HIT", now);
  }

  const upstreamHeaders: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (cached?.lastModified) upstreamHeaders["If-Modified-Since"] = cached.lastModified;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(
      `[proxy-fetch] upstream ${target.hostname} failed:`,
      error instanceof Error ? error.message : error,
    );
    schedule(meter({ host: target.hostname, cache: "UPSTREAM_ERROR", status: 502, authHeader }));
    return json(502, { error: "upstream_unreachable" });
  }

  if (upstream.status === 304 && cached) {
    cached.expiresAt = computeExpiry(rule, upstream.headers, now);
    cacheSet(cacheKey, cached);
    schedule(meter({ host: target.hostname, cache: "REVALIDATED", status: 200, authHeader }));
    return bodyResponse(cached, "REVALIDATED", now);
  }

  if (!upstream.ok) {
    schedule(
      meter({
        host: target.hostname,
        cache: "UPSTREAM_ERROR",
        status: upstream.status,
        authHeader,
      }),
    );
    return json(upstream.status, { error: "upstream", status: upstream.status });
  }

  let body = new Uint8Array(await upstream.arrayBuffer());
  let contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

  if (slim === "north" && target.hostname === "services.swpc.noaa.gov") {
    try {
      body = slimOvationNorth(body);
      contentType = "application/json";
    } catch (error) {
      console.error(
        "[proxy-fetch] slimming failed, passing through:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const entry: CacheEntry = {
    body,
    contentType,
    expiresAt: computeExpiry(rule, upstream.headers, now),
  };
  const lastModified = upstream.headers.get("last-modified");
  if (lastModified) entry.lastModified = lastModified;
  cacheSet(cacheKey, entry);

  schedule(meter({ host: target.hostname, cache: "MISS", status: 200, authHeader }));
  return bodyResponse(entry, "MISS", now);
});

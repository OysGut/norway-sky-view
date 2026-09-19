# Data

One small typed client per external source.

**Direct from the browser** (verified CORS-clean, usable as WebGL textures):
Kartverket WMTS tiles, Terrarium elevation tiles, EOX Sentinel-2 cloudless,
Geonorge place names. These never touch the backend.

**Through `proxy.ts`** (edge function `proxy-fetch`): APIs that need an
identifying `User-Agent`, secrets, server-side caching or response slimming.
Today: MET Norway (`met.ts`) and NOAA OVATION (`noaa.ts`). Every proxied call is
metered as a `usage_events` row.

To add a proxied host: add it to `ALLOWED_HOSTS` in
`supabase/functions/proxy-fetch/index.ts` with a cache TTL, then write a client
here that maps the raw response to a narrow typed shape. Never expose raw
upstream JSON to the rest of the app.

// SPIKE: throwaway diagnostic page — not part of the product, no i18n required.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchLocationForecast } from "@/map/data/met";
import { fetchAuroraNorth } from "@/map/data/noaa";

export const Route = createFileRoute("/spike/data")({
  head: () => ({
    meta: [
      { title: "Data source spike — Himinrond" },
      {
        name: "description",
        content: "Internal diagnostic page measuring direct browser access to open geodata sources.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Data source spike — Himinrond" },
      {
        property: "og:description",
        content: "Internal diagnostic page measuring direct browser access to open geodata sources.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SpikeDataPage,
});

type SourceKind = "image" | "json";

interface Source {
  id: string;
  kind: SourceKind;
  url: string;
}

const SOURCES: readonly Source[] = [
  {
    id: "kartverket-topo",
    kind: "image",
    url: "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/8/72/133.png",
  },
  {
    id: "kartverket-topograatone",
    kind: "image",
    url: "https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/8/72/133.png",
  },
  {
    id: "terrarium-elevation",
    kind: "image",
    url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/8/133/72.png",
  },
  {
    id: "eox-s2cloudless",
    kind: "image",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/8/72/133.jpg",
  },
  {
    id: "geonorge-stedsnavn",
    kind: "json",
    url: "https://ws.geonorge.no/stedsnavn/v1/navn?sok=Galdh%C3%B8piggen&utkoordsys=4258&treffPerSide=5&side=1",
  },
  {
    id: "met-locationforecast",
    kind: "json",
    url: "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=61.6364&lon=8.3125",
  },
  {
    id: "noaa-ovation",
    kind: "json",
    url: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  },
] as const;

interface FetchResult {
  ok: boolean;
  elapsedMs: number;
  status?: number;
  statusText?: string;
  contentType?: string | null;
  byteLength?: number;
  bodyPreview?: string;
  errorName?: string;
  errorMessage?: string;
}

interface ImageResult {
  ok: boolean;
  elapsedMs: number;
  naturalWidth?: number;
  naturalHeight?: number;
  errorMessage?: string;
}

interface CanvasResult {
  ok: boolean;
  elapsedMs: number;
  rgba?: [number, number, number, number];
  elevationMeters?: number;
  errorName?: string;
  errorMessage?: string;
}

interface SourceResult {
  id: string;
  kind: SourceKind;
  url: string;
  fetch: FetchResult;
  img: ImageResult | null;
  canvas: CanvasResult | null;
}

interface ProxyResultRow {
  id: string;
  ok: boolean;
  elapsedMs: number;
  bytes?: number;
  cache?: string | null;
  detail?: string;
  errorMessage?: string;
}

interface SpikeReport {
  userAgent: string;
  timestamp: string;
  results: SourceResult[];
  proxy: ProxyResultRow[];
}

async function runProxyProbes(): Promise<ProxyResultRow[]> {
  const probes: Array<{ id: string; run: () => Promise<{ bytes: number; cache: string | null; detail: string }> }> = [
    {
      id: "met-via-proxy",
      run: async () => {
        const r = await fetchLocationForecast(61.6364, 8.3125);
        const first = r.data.series[0];
        return {
          bytes: r.bytes,
          cache: r.cache,
          detail: `altitude ${r.data.altitude ?? "?"} m · first air temp ${first?.airTemperature ?? "?"} °C · ${r.data.series.length} steps`,
        };
      },
    },
    {
      id: "noaa-via-proxy",
      run: async () => {
        const r = await fetchAuroraNorth();
        return {
          bytes: r.bytes,
          cache: r.cache,
          detail: `${r.data.points.length} points ≥ 45° N · forecast ${r.data.forecastTime}`,
        };
      },
    },
  ];

  return Promise.all(
    probes.map(async (probe): Promise<ProxyResultRow> => {
      const started = performance.now();
      try {
        const out = await probe.run();
        return { id: probe.id, ok: true, elapsedMs: Math.round(performance.now() - started), ...out };
      } catch (error) {
        return {
          id: probe.id,
          ok: false,
          elapsedMs: Math.round(performance.now() - started),
          errorMessage: errorMessage(error),
        };
      }
    }),
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runFetchTest(source: Source): Promise<FetchResult> {
  const started = performance.now();
  try {
    const response = await fetch(source.url, { mode: "cors" });
    const buffer = await response.arrayBuffer();
    const elapsedMs = Math.round(performance.now() - started);

    const result: FetchResult = {
      ok: response.ok,
      elapsedMs,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      byteLength: buffer.byteLength,
    };

    if (source.kind === "json") {
      result.bodyPreview = new TextDecoder().decode(buffer).slice(0, 120);
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      errorName: errorName(error),
      errorMessage: errorMessage(error),
    };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load (network or CORS)"));
    image.src = url;
  });
}

function runCanvasTest(source: Source, image: HTMLImageElement): CanvasResult {
  const started = performance.now();
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context unavailable");

    context.drawImage(image, 0, 0, 256, 256);
    const pixel = context.getImageData(128, 128, 1, 1).data;
    const rgba: [number, number, number, number] = [
      pixel[0] ?? 0,
      pixel[1] ?? 0,
      pixel[2] ?? 0,
      pixel[3] ?? 0,
    ];

    const result: CanvasResult = {
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      rgba,
    };

    if (source.id === "terrarium-elevation") {
      result.elevationMeters =
        Math.round((rgba[0] * 256 + rgba[1] + rgba[2] / 256 - 32768) * 10) / 10;
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      errorName: errorName(error),
      errorMessage: errorMessage(error),
    };
  }
}

async function runSource(source: Source): Promise<SourceResult> {
  const fetchResult = await runFetchTest(source);

  if (source.kind !== "image") {
    return { id: source.id, kind: source.kind, url: source.url, fetch: fetchResult, img: null, canvas: null };
  }

  const started = performance.now();
  let imgResult: ImageResult;
  let canvasResult: CanvasResult;

  try {
    const image = await loadImage(source.url);
    imgResult = {
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    };
    canvasResult = runCanvasTest(source, image);
  } catch (error) {
    imgResult = {
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      errorMessage: errorMessage(error),
    };
    canvasResult = {
      ok: false,
      elapsedMs: 0,
      errorName: "SkippedError",
      errorMessage: "Image did not load, canvas test skipped",
    };
  }

  return { id: source.id, kind: source.kind, url: source.url, fetch: fetchResult, img: imgResult, canvas: canvasResult };
}

function StatusBadge({ ok }: { ok: boolean }) {
  return (
    <Badge
      className={
        ok
          ? "bg-success/15 text-success hover:bg-success/15"
          : "bg-danger/15 text-danger hover:bg-danger/15"
      }
    >
      {ok ? "OK" : "FAIL"}
    </Badge>
  );
}

function Detail({ children }: { children: string }) {
  return <p className="tabular mt-1 max-w-72 truncate text-xs text-muted-foreground" title={children}>{children}</p>;
}

function fetchDetail(result: FetchResult): string {
  if (!result.ok && result.errorName) {
    return `${result.errorName}: ${result.errorMessage ?? ""}`;
  }
  const parts = [
    `${result.status ?? "?"} ${result.statusText ?? ""}`.trim(),
    result.contentType ?? "no content-type",
    `${result.byteLength ?? 0} B`,
    `${result.elapsedMs} ms`,
  ];
  if (result.bodyPreview) parts.push(result.bodyPreview);
  return parts.join(" · ");
}

function imgDetail(result: ImageResult): string {
  return result.ok
    ? `${result.naturalWidth ?? 0} × ${result.naturalHeight ?? 0} · ${result.elapsedMs} ms`
    : (result.errorMessage ?? "failed");
}

function canvasDetail(result: CanvasResult): string {
  if (!result.ok) return `${result.errorName ?? "Error"}: ${result.errorMessage ?? ""}`;
  const rgba = result.rgba ?? [0, 0, 0, 0];
  const base = `rgba(${rgba.join(", ")}) · ${result.elapsedMs} ms`;
  return result.elevationMeters === undefined
    ? base
    : `${base} · elevation ≈ ${result.elevationMeters} m`;
}

function SpikeDataPage() {
  const [report, setReport] = useState<SpikeReport | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setCopied(false);
    const [results, proxy] = await Promise.all([
      Promise.all(SOURCES.map((source) => runSource(source))),
      runProxyProbes(),
    ]);
    setReport({
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      results,
      proxy,
    });
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const copyJson = useCallback(() => {
    if (!report) return;
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      setCopied(true);
    });
  }, [report]);

  return (
    <main className="min-h-screen bg-background px-8 py-12 text-foreground">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-medium">Data source spike</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Measures which external sources the browser can reach directly (fetch), load as an image,
          and read back from a canvas. Throwaway diagnostic page.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={() => void run()} disabled={running}>
            {running ? "Running…" : "Run again"}
          </Button>
          <Button variant="outline" onClick={copyJson} disabled={!report || running}>
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          {running ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          ) : null}
          {report ? (
            <span className="tabular text-xs text-muted-foreground">{report.timestamp}</span>
          ) : null}
        </div>

        <div className="mt-8 rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>fetch</TableHead>
                <TableHead>img</TableHead>
                <TableHead>canvas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SOURCES.map((source) => {
                const result = report?.results.find((entry) => entry.id === source.id);
                return (
                  <TableRow key={source.id}>
                    <TableCell className="align-top font-medium">
                      {source.id}
                      <p className="mt-1 text-xs text-muted-foreground">{source.kind}</p>
                    </TableCell>
                    <TableCell className="max-w-64 align-top">
                      <span className="block truncate text-xs text-muted-foreground" title={source.url}>
                        {source.url}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      {result ? (
                        <>
                          <StatusBadge ok={result.fetch.ok} />
                          <Detail>{fetchDetail(result.fetch)}</Detail>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">…</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {result?.img ? (
                        <>
                          <StatusBadge ok={result.img.ok} />
                          <Detail>{imgDetail(result.img)}</Detail>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{result ? "n/a" : "…"}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {result?.canvas ? (
                        <>
                          <StatusBadge ok={result.canvas.ok} />
                          <Detail>{canvasDetail(result.canvas)}</Detail>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{result ? "n/a" : "…"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <h2 className="mt-10 text-xl font-medium">Via proxy-fetch</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Same upstreams through the edge function: identifying User-Agent, server-side cache
          (X-Proxy-Cache), NOAA slimmed to ≥ 45° N, one usage_events row per call.
        </p>
        <div className="mt-4 rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Probe</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Cache</TableHead>
                <TableHead>Size · time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.proxy ?? [{ id: "met-via-proxy" }, { id: "noaa-via-proxy" }]).map((row) => {
                const full = "ok" in row ? (row as ProxyResultRow) : null;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="align-top font-medium">{row.id}</TableCell>
                    <TableCell className="align-top">
                      {full ? (
                        <>
                          <StatusBadge ok={full.ok} />
                          <Detail>{full.ok ? (full.detail ?? "") : (full.errorMessage ?? "failed")}</Detail>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">…</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular align-top text-xs">{full?.cache ?? (full ? "—" : "…")}</TableCell>
                    <TableCell className="tabular align-top text-xs">
                      {full ? `${Math.round((full.bytes ?? 0) / 1024)} kB · ${full.elapsedMs} ms` : "…"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  );
}

// SPIKE: throwaway diagnostic page — not part of the product, no i18n required.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { lonLatToTilePixel, metersPerPixel } from "@/map/engine/projection";
import { heightStats, sampleBilinear } from "@/map/engine/terrain/terrarium";
import { requestTile } from "@/map/engine/workers/terrariumClient";
import type { DecodedTile } from "@/map/engine/workers/terrariumProtocol";

export const Route = createFileRoute("/spike/elevation")({
  head: () => ({
    meta: [
      { title: "Elevation spike — Himinrond" },
      {
        name: "description",
        content: "Internal diagnostic page: Terrarium decoding in a Web Worker.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpikeElevationPage,
});

interface Probe {
  id: string;
  name: string;
  lat: number;
  lon: number;
  expectedM: number;
  toleranceM: number;
}

const PROBES: readonly Probe[] = [
  {
    id: "galdhopiggen",
    name: "Galdhøpiggen (summit)",
    lat: 61.6364,
    lon: 8.3125,
    expectedM: 2469,
    toleranceM: 40,
  },
  {
    id: "sognefjorden",
    name: "Sognefjorden (sea level, off Balestrand)",
    lat: 61.17,
    lon: 6.56,
    expectedM: 0,
    toleranceM: 5,
  },
];

const ZOOMS = [12, 13, 14] as const;

interface ProbeResult {
  probeId: string;
  z: number;
  tile: string;
  px: number;
  py: number;
  metersPerPixel: number;
  fetchMs: number;
  decodeMs: number;
  bytes: number;
  min: number;
  max: number;
  sampledM: number;
  expectedM: number;
  diffM: number;
  ok: boolean;
  error?: string;
  heights?: Float32Array;
  width?: number;
  height?: number;
}

async function runProbe(probe: Probe, z: number): Promise<ProbeResult> {
  const tp = lonLatToTilePixel(probe.lon, probe.lat, z);
  const base = {
    probeId: probe.id,
    z,
    tile: `${z}/${tp.x}/${tp.y}`,
    px: Math.round(tp.px * 10) / 10,
    py: Math.round(tp.py * 10) / 10,
    metersPerPixel: Math.round(metersPerPixel(probe.lat, z) * 100) / 100,
    expectedM: probe.expectedM,
  };
  try {
    const tile: DecodedTile = await requestTile(z, tp.x, tp.y);
    const stats = heightStats(tile.heights);
    const sampledM = sampleBilinear(tile.heights, tile.width, tile.height, tp.px, tp.py);
    const diffM = sampledM - probe.expectedM;
    return {
      ...base,
      fetchMs: tile.fetchMs,
      decodeMs: tile.decodeMs,
      bytes: tile.bytes,
      min: Math.round(stats.min),
      max: Math.round(stats.max),
      sampledM: Math.round(sampledM * 10) / 10,
      diffM: Math.round(diffM * 10) / 10,
      ok: Math.abs(diffM) <= probe.toleranceM,
      heights: tile.heights,
      width: tile.width,
      height: tile.height,
    };
  } catch (error) {
    return {
      ...base,
      fetchMs: 0,
      decodeMs: 0,
      bytes: 0,
      min: 0,
      max: 0,
      sampledM: Number.NaN,
      diffM: Number.NaN,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function HeightmapCanvas({ result }: { result: ProbeResult }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const { heights, width, height } = result;
    if (!canvas || !heights || !width || !height) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const image = ctx.createImageData(width, height);
    const range = Math.max(1, result.max - result.min);
    for (let i = 0; i < heights.length; i++) {
      const v = Math.round((((heights[i] ?? 0) - result.min) / range) * 255);
      const p = i * 4;
      image.data[p] = v;
      image.data[p + 1] = v;
      image.data[p + 2] = v;
      image.data[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    // crosshair at the probe pixel
    ctx.strokeStyle = "#3FE8B0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(result.px - 8, result.py);
    ctx.lineTo(result.px + 8, result.py);
    ctx.moveTo(result.px, result.py - 8);
    ctx.lineTo(result.px, result.py + 8);
    ctx.stroke();
  }, [result]);

  return (
    <canvas
      ref={ref}
      width={result.width ?? 256}
      height={result.height ?? 256}
      className="h-32 w-32 rounded-sm border border-border"
      title={`${result.tile} heightmap (min→black, max→white)`}
    />
  );
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

function SpikeElevationPage() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timestamp, setTimestamp] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setCopied(false);
    const jobs: Promise<ProbeResult>[] = [];
    for (const probe of PROBES) for (const z of ZOOMS) jobs.push(runProbe(probe, z));
    const all = await Promise.all(jobs);
    setResults(all);
    setTimestamp(new Date().toISOString());
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const copyJson = useCallback(() => {
    const report = {
      userAgent: navigator.userAgent,
      timestamp,
      results: results.map(({ heights: _heights, ...rest }) => rest),
    };
    void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => setCopied(true));
  }, [results, timestamp]);

  return (
    <main className="min-h-screen bg-background px-8 py-12 text-foreground">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-medium">Elevation spike</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Fetches Terrarium tiles in a Web Worker, decodes them to metres, and samples known points
          with bilinear interpolation. Throwaway diagnostic page.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={() => void run()} disabled={running}>
            {running ? "Running…" : "Run again"}
          </Button>
          <Button variant="outline" onClick={copyJson} disabled={results.length === 0 || running}>
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          {running ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          ) : null}
          {timestamp ? (
            <span className="tabular text-xs text-muted-foreground">{timestamp}</span>
          ) : null}
        </div>

        {PROBES.map((probe) => (
          <section key={probe.id} className="mt-10">
            <h2 className="text-xl font-medium">
              {probe.name}{" "}
              <span className="tabular text-sm text-muted-foreground">
                {probe.lat}° N, {probe.lon}° E · expected ≈ {probe.expectedM} m (±{probe.toleranceM}
                )
              </span>
            </h2>
            <div className="mt-4 rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tile</TableHead>
                    <TableHead>m/px</TableHead>
                    <TableHead>Pixel</TableHead>
                    <TableHead>fetch</TableHead>
                    <TableHead>decode</TableHead>
                    <TableHead>min / max</TableHead>
                    <TableHead>Sampled</TableHead>
                    <TableHead>Diff</TableHead>
                    <TableHead>Heightmap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ZOOMS.map((z) => {
                    const r = results.find((x) => x.probeId === probe.id && x.z === z);
                    if (!r) {
                      return (
                        <TableRow key={z}>
                          <TableCell className="tabular">z{z}</TableCell>
                          <TableCell colSpan={8} className="text-xs text-muted-foreground">
                            …
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return (
                      <TableRow key={z}>
                        <TableCell className="tabular align-top font-medium">{r.tile}</TableCell>
                        <TableCell className="tabular align-top">{r.metersPerPixel}</TableCell>
                        <TableCell className="tabular align-top">
                          {r.px}, {r.py}
                        </TableCell>
                        <TableCell className="tabular align-top">
                          {r.fetchMs} ms · {Math.round(r.bytes / 1024)} kB
                        </TableCell>
                        <TableCell className="tabular align-top">{r.decodeMs} ms</TableCell>
                        <TableCell className="tabular align-top">
                          {r.min} / {r.max} m
                        </TableCell>
                        <TableCell className="tabular align-top text-lg">
                          {r.error ? (
                            <span className="text-xs text-danger">{r.error}</span>
                          ) : (
                            `${r.sampledM} m`
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <StatusBadge ok={r.ok} />
                          {!r.error ? (
                            <p className="tabular mt-1 text-xs text-muted-foreground">
                              {r.diffM > 0 ? "+" : ""}
                              {r.diffM} m
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          {r.heights ? <HeightmapCanvas result={r} /> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

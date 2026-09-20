// LOCKED: engine code — modify only on explicit engine tasks.
//
// Web Worker: fetch a Terrarium PNG tile (or read it from the IndexedDB cache),
// decode it into metres, and optionally build the terrain mesh. Typed arrays
// are transferred (not copied) back to the main thread. The worker owns the
// tile cache so heights never cross the thread boundary unless asked for.

import { tileFloatToLonLat } from "../projection";
import { decodeTerrarium, sampleBilinear } from "../terrain/terrarium";
import {
  HeightOracle,
  ORACLE_TILE_SIZE,
  rimEdgeGeometry,
  type OracleTile,
} from "../terrainLOD/heightOracle";
import { buildTerrainMesh, type MeshRim, type RimEdge } from "../terrainLOD/mesher";
import type { RimSpec } from "../terrainLOD/rings";
import { TileCache } from "../terrainLOD/tileCache";
import {
  terrariumTileUrl,
  type DecodeRequest,
  type MeshRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "./terrariumProtocol";

// The DOM lib types `self` as a Window; narrow to what a worker actually offers.
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;
const cache = new TileCache();

interface Heights {
  width: number;
  height: number;
  heights: Float32Array;
  fetchMs: number;
  decodeMs: number;
  bytes: number;
  cached: boolean;
}

async function fetchAndDecode(z: number, x: number, y: number): Promise<Heights> {
  const url = terrariumTileUrl(z, x, y);
  const fetchStart = performance.now();
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${z}/${x}/${y}`);
  const blob = await response.blob();
  const fetchMs = performance.now() - fetchStart;

  const decodeStart = performance.now();
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("OffscreenCanvas 2D context unavailable");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data;
  const heights = decodeTerrarium(rgba, width, height);
  const decodeMs = performance.now() - decodeStart;

  return {
    width,
    height,
    heights,
    fetchMs: Math.round(fetchMs * 10) / 10,
    decodeMs: Math.round(decodeMs * 10) / 10,
    bytes: blob.size,
    cached: false,
  };
}

async function loadHeights(z: number, x: number, y: number): Promise<Heights> {
  const hit = await cache.get({ z, x, y });
  if (hit) {
    return {
      width: hit.width,
      height: hit.height,
      heights: hit.heights.slice(), // copy: the buffer may be transferred to the main thread
      fetchMs: 0,
      decodeMs: 0,
      bytes: hit.bytes,
      cached: true,
    };
  }
  const fresh = await fetchAndDecode(z, x, y);
  // store a copy: the original buffer may be transferred away below
  void cache.put({ z, x, y }, fresh.width, fresh.height, fresh.heights.slice());
  return fresh;
}

/**
 * Deterministic rolling hills for offline testing: a few smooth sines of
 * lon/lat, sampled at pixel-centre GLOBAL coordinates rather than positions
 * local to one tile's own bounds — so two adjacent synthetic tiles (or a fine
 * tile and the coarser tile it stitches against) are exact samples of the
 * same continuous surface and the height oracle can blend across their
 * shared edge without a seam.
 */
function syntheticHeights(z: number, x: number, y: number, size = 256): Heights {
  const heights = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const gy = y * size + j + 0.5; // global pixel row at zoom z
    for (let i = 0; i < size; i++) {
      const gx = x * size + i + 0.5; // global pixel column at zoom z
      const { lon, lat } = tileFloatToLonLat(gx / size, gy / size, z);
      const h =
        900 +
        700 * Math.sin(lon * 40) * Math.cos(lat * 55) +
        350 * Math.sin(lon * 130 + lat * 90) +
        120 * Math.cos(lon * 400) * Math.sin(lat * 300);
      heights[j * size + i] = Math.max(0, h);
    }
  }
  return { width: size, height: size, heights, fetchMs: 0, decodeMs: 0, bytes: 0, cached: false };
}

async function handleDecode(request: DecodeRequest): Promise<WorkerResponse> {
  const { id, z, x, y } = request;
  const h = request.synthetic ? syntheticHeights(z, x, y) : await loadHeights(z, x, y);
  return { type: "decoded", id, z, x, y, ...h };
}

/** Load one tile's heights, in the shape the height oracle wants. */
async function loadOracleTile(
  z: number,
  x: number,
  y: number,
  synthetic: boolean,
): Promise<OracleTile> {
  const h = synthetic ? syntheticHeights(z, x, y) : await loadHeights(z, x, y);
  return { width: h.width, height: h.height, heights: h.heights };
}

/** Read a value from an already-known grid at (i, j), clamped to its own edges. */
function gridSample(grid: Float32Array, n: number, S: number, i: number, j: number): number {
  const ci = i < 0 ? 0 : i > S ? S : i;
  const cj = j < 0 ? 0 : j > S ? S : j;
  return grid[cj * n + ci] ?? 0;
}

const RIM_EDGES: readonly RimEdge[] = ["north", "south", "west", "east"];

/** Build the rim overrides for a mesh request: heights sampled from the coarser ring's oracle at coarse vertex positions. */
async function buildRim(
  request: MeshRequest,
  loadTile: (z: number, x: number, y: number) => Promise<OracleTile>,
): Promise<MeshRim | undefined> {
  const spec: RimSpec | undefined = request.rim;
  if (!spec) return undefined;
  const coarseOracle = new HeightOracle(spec.coarseZoom, loadTile, ORACLE_TILE_SIZE);
  const rim: MeshRim = {};
  for (const edge of RIM_EDGES) {
    if (!spec.edges[edge]) continue;
    const geometry = rimEdgeGeometry(
      { zoom: request.z, x: request.x, y: request.y, segments: request.segments },
      { zoom: spec.coarseZoom, segments: spec.coarseSegments },
      edge,
    );
    const values = await Promise.all(
      Array.from({ length: geometry.quads + 1 }, (_unused, k) => {
        const { gx, gy } = geometry.pixelAt(k);
        return coarseOracle.height(gx, gy);
      }),
    );
    rim[edge] = { quads: geometry.quads, heightAt: (k: number) => values[k] ?? 0 };
  }
  return rim;
}

async function handleMesh(request: MeshRequest): Promise<WorkerResponse> {
  const { id, z, x, y, synthetic } = request;
  const h = synthetic ? syntheticHeights(z, x, y) : await loadHeights(z, x, y);
  const own: OracleTile = { width: h.width, height: h.height, heights: h.heights };
  const meshStart = performance.now();

  // A single loader backs both this tile's own oracle and (if needed) the
  // coarser ring's oracle for rim stitching; the tile this request is for is
  // seeded so it is never fetched twice.
  const loadTile = async (tz: number, tx: number, ty: number): Promise<OracleTile> => {
    if (tz === z && tx === x && ty === y) return own;
    return loadOracleTile(tz, tx, ty, synthetic === true);
  };

  const S = request.segments;
  const n = S + 1;
  const oracle = new HeightOracle(z, loadTile, ORACLE_TILE_SIZE);
  const grid = new Float32Array(n * n);
  // Vertices on a rim edge are overridden by the coarser ring's heights below, so
  // they are sampled from this tile alone: no point fetching the neighbour across
  // a boundary whose values are discarded anyway.
  const rimEdges = request.rim?.edges;
  const onRim = (i: number, j: number): boolean =>
    rimEdges !== undefined &&
    ((j === 0 && rimEdges.north === true) ||
      (j === S && rimEdges.south === true) ||
      (i === 0 && rimEdges.west === true) ||
      (i === S && rimEdges.east === true));
  await Promise.all(
    Array.from({ length: n * n }, (_unused, k) => {
      const i = k % n;
      const j = Math.floor(k / n);
      if (onRim(i, j)) {
        grid[k] = Math.max(
          0,
          sampleBilinear(h.heights, h.width, h.height, (i / S) * h.width, (j / S) * h.height),
        );
        return Promise.resolve();
      }
      const gx = x * ORACLE_TILE_SIZE + (i / S) * ORACLE_TILE_SIZE;
      const gy = y * ORACLE_TILE_SIZE + (j / S) * ORACLE_TILE_SIZE;
      return oracle.height(gx, gy).then((height) => {
        grid[k] = height;
      });
    }),
  );
  const heightAt = (u: number, v: number): number =>
    gridSample(grid, n, S, Math.round(u * S), Math.round(v * S));

  const rim = await buildRim(request, loadTile);

  const mesh = buildTerrainMesh({
    heightAt,
    widthM: request.widthM,
    depthM: request.depthM,
    segments: request.segments,
    skirtDepth: request.skirtDepth,
    hole: request.hole,
    rim,
  });
  return {
    type: "meshed",
    id,
    z,
    x,
    y,
    mesh,
    fetchMs: h.fetchMs,
    decodeMs: h.decodeMs,
    meshMs: Math.round((performance.now() - meshStart) * 10) / 10,
    cached: h.cached,
  };
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  const job = request.type === "decode" ? handleDecode(request) : handleMesh(request);

  void job
    .catch((error: unknown): WorkerResponse => ({
      type: "error",
      id: request.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }))
    .then((response) => {
      let transfer: Transferable[] = [];
      if (response.type === "decoded") transfer = [response.heights.buffer];
      if (response.type === "meshed") {
        const m = response.mesh;
        transfer = [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.indices.buffer];
      }
      scope.postMessage(response, transfer);
    });
});

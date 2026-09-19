// LOCKED: engine code — modify only on explicit engine tasks.
//
// Web Worker: fetch a Terrarium PNG tile (or read it from the IndexedDB cache),
// decode it into metres, and optionally build the terrain mesh. Typed arrays
// are transferred (not copied) back to the main thread. The worker owns the
// tile cache so heights never cross the thread boundary unless asked for.

import { tileToLonLatBounds } from "../projection";
import { decodeTerrarium } from "../terrain/terrarium";
import { buildTerrainMesh } from "../terrainLOD/mesher";
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

/** Deterministic rolling hills for offline testing: a few smooth sines of lon/lat. */
function syntheticHeights(z: number, x: number, y: number, size = 256): Heights {
  const b = tileToLonLatBounds(x, y, z);
  const heights = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const lat = b.north + ((b.south - b.north) * (j + 0.5)) / size;
    for (let i = 0; i < size; i++) {
      const lon = b.west + ((b.east - b.west) * (i + 0.5)) / size;
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

async function handleMesh(request: MeshRequest): Promise<WorkerResponse> {
  const { id, z, x, y } = request;
  const h = request.synthetic ? syntheticHeights(z, x, y) : await loadHeights(z, x, y);
  const meshStart = performance.now();
  const mesh = buildTerrainMesh({
    heights: h.heights,
    width: h.width,
    height: h.height,
    widthM: request.widthM,
    depthM: request.depthM,
    segments: request.segments,
    skirtDepth: request.skirtDepth,
    hole: request.hole,
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

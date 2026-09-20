// LOCKED: engine code — modify only on explicit engine tasks.
//
// Global pixel-centre height oracle: treats Terrarium pixel (i, j) of tile
// (z, x, y) as a sample sitting at global pixel-centre coordinate
// (x·256 + i + 0.5, y·256 + j + 0.5), and bilinearly interpolates between the
// four nearest pixel centres — fetching a neighbouring tile from the cache
// when a needed pixel lies across a tile boundary. This is what makes two
// tiles that share an edge (two same-zoom neighbours, or a fine tile against
// a coarser one) compute bit-identical heights there: both go through this
// same function with the same global inputs.
//
// Sea-level clamp (h < 0 → 0) is applied to each pixel sample BEFORE
// interpolation, exactly as the mesher clamps its own tile's samples.
//
// Pure aside from the injected `loader`; safe to use from the worker (which
// backs the loader with fetch/IndexedDB/synthetic heights) and from tests
// (which can pass a trivial in-memory loader).

import type { RimEdge } from "./mesher";

export const ORACLE_TILE_SIZE = 256;

export interface OracleTile {
  width: number;
  height: number;
  heights: Float32Array;
}

/**
 * Loads one decoded tile (fetch, cache or synthetic — whatever the caller
 * wants). May reject; the oracle does not swallow that, it propagates so a
 * mesh build fails loudly rather than silently drawing a wrong edge.
 */
export type TileLoader = (z: number, x: number, y: number) => Promise<OracleTile>;

function clampSea(h: number): number {
  return h < 0 ? 0 : h;
}

/**
 * Pixel-centre height oracle for one zoom level. Fetched tiles are memoised
 * for the lifetime of this instance — construct one per mesh-build request
 * (or per request, per zoom, when also stitching against a coarser ring).
 */
export class HeightOracle {
  private readonly cache = new Map<string, Promise<OracleTile>>();

  constructor(
    private readonly zoom: number,
    private readonly loader: TileLoader,
    private readonly tileSize: number = ORACLE_TILE_SIZE,
  ) {}

  private loadTile(x: number, y: number): Promise<OracleTile> {
    const n = 2 ** this.zoom;
    const wx = ((x % n) + n) % n; // the world wraps horizontally at every zoom
    const key = `${wx},${y}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.loader(this.zoom, wx, y);
      this.cache.set(key, p);
    }
    return p;
  }

  /** Sea-clamped value of the global pixel at integer indices (gi, gj). `gj` is edge-clamped (no pole wrap); `gi` wraps around the globe. */
  private async pixelAt(gi: number, gj: number): Promise<number> {
    const n = 2 ** this.zoom;
    const size = this.tileSize;
    const maxGy = n * size - 1;
    const cgj = gj < 0 ? 0 : gj > maxGy ? maxGy : gj;
    const maxGx = n * size;
    const wgi = ((gi % maxGx) + maxGx) % maxGx;
    const tx = Math.floor(wgi / size);
    const ty = Math.floor(cgj / size);
    const px = wgi - tx * size;
    const py = cgj - ty * size;
    const tile = await this.loadTile(tx, ty);
    const idx = py * tile.width + px;
    return clampSea(tile.heights[idx] ?? 0);
  }

  /**
   * H_z(gx, gy): bilinear interpolation between the four nearest pixel
   * centres at global pixel coordinates (gx, gy). Evaluating exactly at a
   * pixel centre (e.g. gx = x·256 + i + 0.5) returns that pixel's own value.
   */
  async height(gx: number, gy: number): Promise<number> {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const [h00, h10, h01, h11] = await Promise.all([
      this.pixelAt(x0, y0),
      this.pixelAt(x0 + 1, y0),
      this.pixelAt(x0, y0 + 1),
      this.pixelAt(x0 + 1, y0 + 1),
    ]);
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * ty;
  }
}

export interface RimEdgeGeometry {
  /** Coarse quads this fine edge spans (S / 2^(fineZoom - coarseZoom)). */
  quads: number;
  /** Global pixel coordinates at the COARSE zoom of coarse vertex k = 0..quads along this edge. */
  pixelAt: (k: number) => { gx: number; gy: number };
}

/**
 * Geometry for stitching one edge of a fine tile to the coarser ring's mesh.
 * Pure and synchronous: it only computes WHERE, in the coarse zoom's global
 * pixel space, each coarse vertex along this edge sits — using the exact same
 * "tile origin · 256 + (ic / S) · 256" formula the coarse tile's own mesher
 * uses for its vertices, so sampling `HeightOracle.height` there reproduces
 * the coarse mesh's own vertex heights exactly (same formula, same inputs).
 */
export function rimEdgeGeometry(
  fine: { zoom: number; x: number; y: number; segments: number },
  coarse: { zoom: number; segments: number },
  edge: RimEdge,
  tileSize: number = ORACLE_TILE_SIZE,
): RimEdgeGeometry {
  const dz = fine.zoom - coarse.zoom;
  if (!Number.isInteger(dz) || dz <= 0) {
    throw new Error(
      `rimEdgeGeometry: coarse zoom ${coarse.zoom} must be a whole number of levels below fine zoom ${fine.zoom}`,
    );
  }
  if (fine.segments !== coarse.segments) {
    throw new Error("rimEdgeGeometry: fine and coarse rings must share the same segment count");
  }
  const S = fine.segments;
  const r = 2 ** dz;
  if (S % r !== 0) {
    throw new Error(`rimEdgeGeometry: segments ${S} is not divisible by the zoom ratio ${r}`);
  }
  const quads = S / r;
  const xc = Math.floor(fine.x / r);
  const yc = Math.floor(fine.y / r);
  const colWest = (fine.x - xc * r) * quads;
  const rowNorth = (fine.y - yc * r) * quads;
  const pxPerVertex = tileSize / S;
  const originGx = xc * tileSize;
  const originGy = yc * tileSize;

  let colAt: (k: number) => number;
  let rowAt: (k: number) => number;
  switch (edge) {
    case "north":
      colAt = (k) => colWest + k;
      rowAt = () => rowNorth;
      break;
    case "south":
      colAt = (k) => colWest + k;
      rowAt = () => rowNorth + quads;
      break;
    case "west":
      colAt = () => colWest;
      rowAt = (k) => rowNorth + k;
      break;
    case "east":
      colAt = () => colWest + quads;
      rowAt = (k) => rowNorth + k;
      break;
  }
  return {
    quads,
    pixelAt: (k) => ({
      gx: originGx + colAt(k) * pxPerVertex,
      gy: originGy + rowAt(k) * pxPerVertex,
    }),
  };
}

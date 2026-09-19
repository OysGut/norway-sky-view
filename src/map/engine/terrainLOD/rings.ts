// LOCKED: engine code — modify only on explicit engine tasks.
//
// Concentric tile rings around the user: a dense near ring, a mid ring and a
// coarse far ring, each at its own zoom. Coarser tiles get a rectangular hole
// where a finer ring covers them (or are skipped when fully covered), so the
// rings nest without z-fighting. Skirts on every tile hide the seams.

import {
  lonLatToTile,
  tileToLonLatBounds,
  type LonLat,
  type LonLatBounds,
  type TileKey,
} from "../projection";

export interface RingSpec {
  zoom: number;
  /** Tiles on each side of the centre tile (ring = 2 → 5 × 5). */
  ring: number;
  /** Quads per tile side. */
  segments: number;
  /** Skirt depth in metres. */
  skirtDepth: number;
}

/** Default rings: ≈ 11.6 km / 93 km / 373 km across at 61° N. */
export const DEFAULT_RINGS: readonly RingSpec[] = [
  { zoom: 13, ring: 2, segments: 64, skirtDepth: 60 },
  { zoom: 11, ring: 2, segments: 64, skirtDepth: 200 },
  { zoom: 9, ring: 2, segments: 64, skirtDepth: 800 },
];

export interface Hole {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TileJob extends TileKey {
  segments: number;
  skirtDepth: number;
  bounds: LonLatBounds;
  hole?: Hole | undefined;
  /** Stable identity including the hole, so a changed hole re-meshes the tile. */
  jobKey: string;
}

function ringTiles(center: TileKey, ring: number): TileKey[] {
  const n = 2 ** center.z;
  const out: TileKey[] = [];
  for (let dy = -ring; dy <= ring; dy++) {
    const y = center.y + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -ring; dx <= ring; dx++) {
      out.push({ z: center.z, x: (((center.x + dx) % n) + n) % n, y });
    }
  }
  return out;
}

function unionBounds(tiles: TileKey[]): LonLatBounds | null {
  if (tiles.length === 0) return null;
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  for (const t of tiles) {
    const b = tileToLonLatBounds(t.x, t.y, t.z);
    west = Math.min(west, b.west);
    east = Math.max(east, b.east);
    south = Math.min(south, b.south);
    north = Math.max(north, b.north);
  }
  return { west, east, south, north };
}

const EPS = 1e-9;

/** Hole in `tile` (uv) covered by `inner`; null = no overlap; "full" = fully covered. */
export function holeFor(tile: LonLatBounds, inner: LonLatBounds): Hole | "full" | null {
  const west = Math.max(tile.west, inner.west);
  const east = Math.min(tile.east, inner.east);
  const south = Math.max(tile.south, inner.south);
  const north = Math.min(tile.north, inner.north);
  if (east - west <= EPS || north - south <= EPS) return null;
  const covers =
    west <= tile.west + EPS &&
    east >= tile.east - EPS &&
    south <= tile.south + EPS &&
    north >= tile.north - EPS;
  if (covers) return "full";
  const w = tile.east - tile.west;
  const h = tile.north - tile.south;
  return {
    u0: (west - tile.west) / w,
    u1: (east - tile.west) / w,
    v0: (tile.north - north) / h,
    v1: (tile.north - south) / h,
  };
}

function holeKey(hole: Hole | undefined): string {
  if (!hole) return "";
  const r = (v: number) => Math.round(v * 1000);
  return `|h${r(hole.u0)},${r(hole.v0)},${r(hole.u1)},${r(hole.v1)}`;
}

/** Plan every tile mesh needed around `center`, finest ring first. */
export function planRings(center: LonLat, specs: readonly RingSpec[] = DEFAULT_RINGS): TileJob[] {
  const sorted = [...specs].sort((a, b) => b.zoom - a.zoom); // finest first
  const jobs: TileJob[] = [];
  let innerFootprint: LonLatBounds | null = null;

  for (const spec of sorted) {
    const centerTile = lonLatToTile(center.lon, center.lat, spec.zoom);
    const tiles = ringTiles(centerTile, spec.ring);
    for (const t of tiles) {
      const bounds = tileToLonLatBounds(t.x, t.y, t.z);
      let hole: Hole | undefined;
      if (innerFootprint) {
        const h = holeFor(bounds, innerFootprint);
        if (h === "full") continue;
        if (h) hole = h;
      }
      jobs.push({
        ...t,
        segments: spec.segments,
        skirtDepth: spec.skirtDepth,
        bounds,
        hole,
        jobKey: `${t.z}/${t.x}/${t.y}${holeKey(hole)}`,
      });
    }
    innerFootprint = unionBounds(tiles);
  }
  return jobs;
}

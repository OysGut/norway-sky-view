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
import type { RimEdge } from "./mesher";

export interface RingSpec {
  zoom: number;
  /** Tiles on each side of the centre tile (ring = 2 → 5 × 5). */
  ring: number;
  /** Quads per tile side. */
  segments: number;
  /** Skirt depth in metres. */
  skirtDepth: number;
}

// Skirt depths: with rims and the shared pixel-centre oracle removing the
// metres-scale ledges these used to hide, they only need to cover residual
// float noise at the seams — small, zoom-scaled values are plenty.
/** Default rings: ≈ 11.6 km / 46 km / 186 km / 745 km across at 61° N (the outer one carries the horizon). */
export const DEFAULT_RINGS: readonly RingSpec[] = [
  { zoom: 13, ring: 2, segments: 64, skirtDepth: 5 },
  { zoom: 11, ring: 2, segments: 64, skirtDepth: 10 },
  { zoom: 9, ring: 2, segments: 64, skirtDepth: 20 },
  { zoom: 7, ring: 2, segments: 64, skirtDepth: 40 },
];

/** Speeds (m/s) above which the two finest, then the three finest, rings are dropped. */
export const FAST_SPEED_MPS = 2_000;
export const VERY_FAST_SPEED_MPS = 20_000;

/**
 * Ring specs to keep while the user moves at `speedMps`: all of them when slow, only the
 * coarser ones when flying, so fine tiles are not fetched and discarded every frame.
 */
export function ringsForSpeed(
  speedMps: number,
  specs: readonly RingSpec[] = DEFAULT_RINGS,
): readonly RingSpec[] {
  const drop = speedMps > VERY_FAST_SPEED_MPS ? 3 : speedMps > FAST_SPEED_MPS ? 2 : 0;
  if (drop === 0 || specs.length <= drop) return specs;
  // while flying, a 3 × 3 block of the finest remaining ring is enough (the view is high up)
  // and keeps each re-plan to a handful of tiles
  return specs
    .slice(drop)
    .map((spec, i) => (i === 0 ? { ...spec, ring: Math.min(spec.ring, 1) } : spec));
}

export interface Hole {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Which edges of a tile are pinned to the next coarser ring's own mesh, and that ring's zoom/segments. */
export interface RimSpec {
  coarseZoom: number;
  coarseSegments: number;
  edges: Partial<Record<RimEdge, true>>;
}

export interface TileJob extends TileKey {
  segments: number;
  skirtDepth: number;
  bounds: LonLatBounds;
  hole?: Hole | undefined;
  /** Edges bordering the next coarser ring, to be pinned to its surface. Absent for the outermost ring. */
  rim?: RimSpec | undefined;
  /** Stable identity including the hole and rim, so either changing re-meshes the tile. */
  jobKey: string;
}

interface RingTile extends TileKey {
  /** Offset from the ring's centre tile, in tiles. */
  dx: number;
  dy: number;
}

function ringTiles(center: TileKey, ring: number): RingTile[] {
  const n = 2 ** center.z;
  const out: RingTile[] = [];
  for (let dy = -ring; dy <= ring; dy++) {
    const y = center.y + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -ring; dx <= ring; dx++) {
      out.push({ z: center.z, x: (((center.x + dx) % n) + n) % n, y, dx, dy });
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

const RIM_EDGE_ORDER: readonly RimEdge[] = ["north", "south", "west", "east"];

function rimKey(rim: RimSpec | undefined): string {
  if (!rim) return "";
  const letters = RIM_EDGE_ORDER.filter((e) => rim.edges[e])
    .map((e) => e[0])
    .join("");
  return `|r${rim.coarseZoom}:${letters}`;
}

/** Rim edges for a tile at ring offset (dx, dy): the sides that face away from the ring's centre. */
function rimEdgesFor(dx: number, dy: number, ring: number): Partial<Record<RimEdge, true>> {
  const edges: Partial<Record<RimEdge, true>> = {};
  if (dy === -ring) edges.north = true;
  if (dy === ring) edges.south = true;
  if (dx === -ring) edges.west = true;
  if (dx === ring) edges.east = true;
  return edges;
}

/** Plan every tile mesh needed around `center`, finest ring first. */
export function planRings(center: LonLat, specs: readonly RingSpec[] = DEFAULT_RINGS): TileJob[] {
  const sorted = [...specs].sort((a, b) => b.zoom - a.zoom); // finest first
  const jobs: TileJob[] = [];
  let innerFootprint: LonLatBounds | null = null;

  for (let s = 0; s < sorted.length; s++) {
    const spec = sorted[s];
    if (!spec) continue;
    const coarser = sorted[s + 1]; // undefined for the outermost ring: nothing to stitch against
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
      let rim: RimSpec | undefined;
      if (coarser) {
        const edges = rimEdgesFor(t.dx, t.dy, spec.ring);
        if (Object.keys(edges).length > 0) {
          rim = { coarseZoom: coarser.zoom, coarseSegments: coarser.segments, edges };
        }
      }
      jobs.push({
        z: t.z,
        x: t.x,
        y: t.y,
        segments: spec.segments,
        skirtDepth: spec.skirtDepth,
        bounds,
        hole,
        rim,
        jobKey: `${t.z}/${t.x}/${t.y}${holeKey(hole)}${rimKey(rim)}`,
      });
    }
    innerFootprint = unionBounds(tiles);
  }
  return jobs;
}

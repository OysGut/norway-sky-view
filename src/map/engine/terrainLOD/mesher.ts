// LOCKED: engine code — modify only on explicit engine tasks.
//
// Builds a terrain mesh for one tile from a height sampler. Pure typed-array
// code, safe to run in a worker (no fetching happens here — see heightOracle.ts
// and the worker for that). Output vertices are in tile-local ENU metres
// relative to the tile centre (x = east, y = up, z = -north) so the mesh can be
// placed with a single translation and reused while the world root moves.
//
// Physical earth curvature is NOT baked here: it depends on the viewer's
// position and is applied analytically in the shared bend shader chunk.
//
// Features:
//   • decimation to `segments` × `segments` quads, height from `heightAt(u, v)`
//   • analytic normals from the sampled grid
//   • optional skirts: vertical flaps along the outer edges hanging `skirtDepth`
//     metres down, hiding sub-metre float cracks against neighbours
//   • optional rectangular hole (in tile uv) where a finer ring covers this tile
//   • optional rim: edge vertices pinned to the coarser ring's own mesh, so a
//     fine tile's outer border lies exactly on the coarse surface (no ledges)

import { sampleBilinear } from "../terrain/terrarium";

export type RimEdge = "north" | "south" | "west" | "east";

/** Height at coarse vertex k = 0..quads along one edge (west→east for north/south, north→south for west/east). */
export interface MeshRimEdge {
  quads: number;
  heightAt: (k: number) => number;
}

export type MeshRim = Partial<Record<RimEdge, MeshRimEdge>>;

export interface MeshHole {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface MeshOptions {
  /**
   * Preferred sampler: tile uv (u right 0..1, v down 0..1 from the north-west
   * corner) → metres, already sea-level clamped. This is what the worker uses
   * (backed by the pixel-centre height oracle) so that two tiles sharing an
   * edge compute identical heights there.
   */
  heightAt?: ((u: number, v: number) => number) | undefined;
  /** Legacy sampler: decoded heights, row-major, `width` × `height`, metres, bilinear-sampled. */
  heights?: Float32Array | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Ground extent of the tile in metres (east-west, north-south). */
  widthM: number;
  depthM: number;
  /** Quads per side. */
  segments: number;
  /** Skirt depth in metres; 0 disables skirts. */
  skirtDepth?: number | undefined;
  /** Rectangle in tile uv (u right, v down from the north-west corner) where no triangles are emitted. */
  hole?: MeshHole | undefined;
  /** Heights at or below this value are treated as sea and clamped to 0 (Terrarium sea floor is negative). Only applies to the legacy `heights` sampler — `heightAt` is expected to already be sea-clamped. */
  seaLevelClamp?: boolean | undefined;
  /** Edge vertices pinned to the coarser ring's piecewise-linear surface, applied before normals are computed. */
  rim?: MeshRim | undefined;
}

export interface TerrainMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  minHeight: number;
  maxHeight: number;
}

function legacySampler(o: MeshOptions): (u: number, v: number) => number {
  const { heights, width, height } = o;
  if (!heights || width === undefined || height === undefined) {
    throw new Error("buildTerrainMesh: provide either heightAt or heights/width/height");
  }
  const clampSea = o.seaLevelClamp ?? true;
  return (u: number, v: number): number => {
    let h = sampleBilinear(heights, width, height, u * width, v * height);
    if (clampSea && h < 0) h = 0;
    return h;
  };
}

/** Height at coarse vertex index `iOrJ` (0..S) along a rim edge spanning `edge.quads` coarse quads. */
function rimHeightAt(edge: MeshRimEdge, iOrJ: number, S: number): number {
  const t = (iOrJ * edge.quads) / S;
  const k = Math.min(edge.quads - 1, Math.max(0, Math.floor(t)));
  const f = t - k;
  const h0 = edge.heightAt(k);
  const h1 = edge.heightAt(k + 1);
  return h0 + (h1 - h0) * f;
}

/**
 * Build the mesh. Vertex (i, j) with i along east (0..S) and j along south (0..S)
 * sits at u = i/S, v = j/S; z = -north so v increases toward +z.
 */
export function buildTerrainMesh(o: MeshOptions): TerrainMesh {
  const S = Math.max(1, Math.floor(o.segments));
  const n = S + 1;
  const skirt = o.skirtDepth ?? 0;
  const useSkirt = skirt > 0;
  const heightAt = o.heightAt ?? legacySampler(o);

  const gridCount = n * n;
  const skirtCount = useSkirt ? 4 * n : 0;
  const vertexCount = gridCount + skirtCount;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // 1) heights on the decimated grid
  const grid = new Float32Array(gridCount);
  for (let j = 0; j < n; j++) {
    const v = j / S;
    for (let i = 0; i < n; i++) {
      const u = i / S;
      grid[j * n + i] = heightAt(u, v);
    }
  }

  // 1b) rim: pin edge vertices to the coarser ring's own surface, before normals
  const rim = o.rim;
  if (rim?.north) for (let i = 0; i < n; i++) grid[i] = rimHeightAt(rim.north, i, S);
  if (rim?.south) for (let i = 0; i < n; i++) grid[S * n + i] = rimHeightAt(rim.south, i, S);
  if (rim?.west) for (let j = 0; j < n; j++) grid[j * n] = rimHeightAt(rim.west, j, S);
  if (rim?.east) for (let j = 0; j < n; j++) grid[j * n + S] = rimHeightAt(rim.east, j, S);

  // 2) positions + uvs (+ min/max over the final, possibly rim-overridden grid)
  let minH = Number.POSITIVE_INFINITY;
  let maxH = Number.NEGATIVE_INFINITY;
  const dx = o.widthM / S;
  const dz = o.depthM / S;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = grid[k] ?? 0;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      positions[k * 3] = -o.widthM / 2 + i * dx;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = -o.depthM / 2 + j * dz;
      uvs[k * 2] = i / S;
      uvs[k * 2 + 1] = 1 - j / S; // three.js textures have v = 0 at the bottom (south)
    }
  }

  // 3) normals from central differences (one-sided at the edges)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const hl = grid[j * n + Math.max(0, i - 1)] ?? 0;
      const hr = grid[j * n + Math.min(S, i + 1)] ?? 0;
      const hu = grid[Math.max(0, j - 1) * n + i] ?? 0;
      const hd = grid[Math.min(S, j + 1) * n + i] ?? 0;
      const spanX = (Math.min(S, i + 1) - Math.max(0, i - 1)) * dx;
      const spanZ = (Math.min(S, j + 1) - Math.max(0, j - 1)) * dz;
      // surface: y = h(x, z); normal ∝ (-dh/dx, 1, -dh/dz)
      let nx = -(hr - hl) / spanX;
      let ny = 1;
      let nz = -(hd - hu) / spanZ;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
    }
  }

  // 4) skirt vertices: copies of the edge vertices pushed down, same uv/normal
  if (useSkirt) {
    let s = gridCount;
    const copyDown = (src: number, dst: number) => {
      positions[dst * 3] = positions[src * 3] ?? 0;
      positions[dst * 3 + 1] = (positions[src * 3 + 1] ?? 0) - skirt;
      positions[dst * 3 + 2] = positions[src * 3 + 2] ?? 0;
      normals[dst * 3] = normals[src * 3] ?? 0;
      normals[dst * 3 + 1] = normals[src * 3 + 1] ?? 1;
      normals[dst * 3 + 2] = normals[src * 3 + 2] ?? 0;
      uvs[dst * 2] = uvs[src * 2] ?? 0;
      uvs[dst * 2 + 1] = uvs[src * 2 + 1] ?? 0;
    };
    for (let i = 0; i < n; i++) copyDown(i, s++); // north edge (j = 0)
    for (let i = 0; i < n; i++) copyDown(S * n + i, s++); // south edge (j = S)
    for (let j = 0; j < n; j++) copyDown(j * n, s++); // west edge (i = 0)
    for (let j = 0; j < n; j++) copyDown(j * n + S, s++); // east edge (i = S)
  }

  // 5) indices (counter-clockwise seen from above, i.e. from +y)
  const hole = o.hole;
  const indexList: number[] = [];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      if (hole) {
        const cu = (i + 0.5) / S;
        const cv = (j + 0.5) / S;
        if (cu > hole.u0 && cu < hole.u1 && cv > hole.v0 && cv < hole.v1) continue;
      }
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // viewed from +y with x right and z toward the viewer's bottom, CCW is a, c, b / b, c, d
      indexList.push(a, c, b, b, c, d);
    }
  }
  if (useSkirt) {
    const north = gridCount;
    const south = gridCount + n;
    const west = gridCount + 2 * n;
    const east = gridCount + 3 * n;
    for (let i = 0; i < S; i++) {
      // north edge: top vertices i, i+1 ; skirt north+i, north+i+1 — face outward (-z)
      indexList.push(i, i + 1, north + i, i + 1, north + i + 1, north + i);
      // south edge (faces +z)
      const t0 = S * n + i;
      indexList.push(t0 + 1, t0, south + i, t0 + 1, south + i, south + i + 1);
    }
    for (let j = 0; j < S; j++) {
      // west edge (faces -x)
      const t0 = j * n;
      indexList.push(t0 + n, t0, west + j, t0 + n, west + j, west + j + 1);
      // east edge (faces +x)
      const e0 = j * n + S;
      indexList.push(e0, e0 + n, east + j, e0 + n, east + j + 1, east + j);
    }
  }

  const indices = new Uint32Array(indexList);
  return {
    positions,
    normals,
    uvs,
    indices,
    vertexCount,
    triangleCount: indices.length / 3,
    minHeight: minH,
    maxHeight: maxH,
  };
}

/** Bytes the mesh occupies (for cache/memory accounting). */
export function meshBytes(m: TerrainMesh): number {
  return m.positions.byteLength + m.normals.byteLength + m.uvs.byteLength + m.indices.byteLength;
}

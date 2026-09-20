// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import { HeightOracle, type OracleTile, type TileLoader } from "./heightOracle";
import { buildTerrainMesh, meshBytes } from "./mesher";

function flat(w: number, h: number, value: number): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** heights increasing eastwards: h = slope · px */
function rampEast(w: number, h: number, slopePerPixel: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = i * slopePerPixel;
  return out;
}

describe("buildTerrainMesh", () => {
  it("builds a flat grid with the right counts, extents and upward normals", () => {
    const m = buildTerrainMesh({
      heights: flat(8, 8, 100),
      width: 8,
      height: 8,
      widthM: 1000,
      depthM: 800,
      segments: 4,
    });
    expect(m.vertexCount).toBe(25);
    expect(m.triangleCount).toBe(32);
    expect(m.minHeight).toBe(100);
    expect(m.maxHeight).toBe(100);
    // extents: x in [-500, 500], z in [-400, 400], y = 100
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let k = 0; k < m.vertexCount; k++) {
      minX = Math.min(minX, m.positions[k * 3] ?? 0);
      maxX = Math.max(maxX, m.positions[k * 3] ?? 0);
      minZ = Math.min(minZ, m.positions[k * 3 + 2] ?? 0);
      maxZ = Math.max(maxZ, m.positions[k * 3 + 2] ?? 0);
      expect(m.positions[k * 3 + 1]).toBe(100);
      expect(m.normals[k * 3 + 1]).toBeCloseTo(1, 9);
    }
    expect([minX, maxX, minZ, maxZ]).toEqual([-500, 500, -400, 400]);
    // uv: first vertex is the north-west corner → u 0, v 1
    expect(m.uvs[0]).toBe(0);
    expect(m.uvs[1]).toBe(1);
    // indices in range
    for (const idx of m.indices) expect(idx).toBeLessThan(m.vertexCount);
  });

  it("orients triangles counter-clockwise seen from above", () => {
    const m = buildTerrainMesh({
      heights: flat(4, 4, 0),
      width: 4,
      height: 4,
      widthM: 100,
      depthM: 100,
      segments: 1,
    });
    const [a, b, c] = [m.indices[0] ?? 0, m.indices[1] ?? 0, m.indices[2] ?? 0];
    const p = (k: number) => [m.positions[k * 3] ?? 0, m.positions[k * 3 + 2] ?? 0] as const;
    const [ax, az] = p(a);
    const [bx, bz] = p(b);
    const [cx, cz] = p(c);
    // screen frame from above: right = +x, up = -z  ⇒ use (x, -z)
    const cross = (bx - ax) * -(cz - az) - -(bz - az) * (cx - ax);
    expect(cross).toBeGreaterThan(0);
  });

  it("tilts normals against an eastward slope", () => {
    const m = buildTerrainMesh({
      heights: rampEast(16, 16, 10), // 10 m per pixel
      width: 16,
      height: 16,
      widthM: 1600, // 100 m per pixel → slope 0.1
      depthM: 1600,
      segments: 8,
      seaLevelClamp: false,
    });
    // interior vertex (i = 4, j = 4)
    const k = 4 * 9 + 4;
    const nx = m.normals[k * 3] ?? 0;
    const ny = m.normals[k * 3 + 1] ?? 0;
    expect(nx).toBeLessThan(0); // uphill is +x, so the normal leans to -x
    expect(nx / ny).toBeCloseTo(-0.1, 3);
  });

  it("clamps sea-floor heights to zero by default", () => {
    const m = buildTerrainMesh({
      heights: flat(4, 4, -120),
      width: 4,
      height: 4,
      widthM: 100,
      depthM: 100,
      segments: 2,
    });
    expect(m.minHeight).toBe(0);
    expect(m.maxHeight).toBe(0);
  });

  it("adds skirt vertices hanging down along the four edges", () => {
    const m = buildTerrainMesh({
      heights: flat(4, 4, 50),
      width: 4,
      height: 4,
      widthM: 100,
      depthM: 100,
      segments: 2,
      skirtDepth: 20,
    });
    expect(m.vertexCount).toBe(9 + 4 * 3);
    // skirt vertices sit 20 m lower
    for (let k = 9; k < m.vertexCount; k++) expect(m.positions[k * 3 + 1]).toBe(30);
    // 8 grid triangles + 4 edges × 2 quads × 2 triangles
    expect(m.triangleCount).toBe(8 + 16);
  });

  it("leaves a hole where a finer ring covers the tile", () => {
    const m = buildTerrainMesh({
      heights: flat(4, 4, 0),
      width: 4,
      height: 4,
      widthM: 100,
      depthM: 100,
      segments: 4,
      hole: { u0: 0.25, v0: 0.25, u1: 0.75, v1: 0.75 },
    });
    // 16 cells, the central 2×2 removed → 12 cells × 2 triangles
    expect(m.triangleCount).toBe(24);
  });

  it("reports its byte size", () => {
    const m = buildTerrainMesh({
      heights: flat(4, 4, 0),
      width: 4,
      height: 4,
      widthM: 100,
      depthM: 100,
      segments: 2,
    });
    expect(meshBytes(m)).toBe(9 * 3 * 4 + 9 * 3 * 4 + 9 * 2 * 4 + 24 * 4);
  });

  it("samples heights through a heightAt(u, v) callback instead of a raw grid", () => {
    const m = buildTerrainMesh({
      heightAt: (u, v) => 100 * u + 10 * v,
      widthM: 100,
      depthM: 100,
      segments: 2,
    });
    // vertex (i=2, j=1) → u=1, v=0.5 → 100 + 5 = 105
    expect(m.positions[(1 * 3 + 2) * 3 + 1]).toBeCloseTo(105, 9);
  });

  function makeOracleTile(size: number, valueAt: (i: number, j: number) => number): OracleTile {
    const heights = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) heights[j * size + i] = valueAt(i, j);
    }
    return { width: size, height: size, heights };
  }

  it("gives two adjacent same-zoom tiles bit-identical heights along their shared edge", async () => {
    const Z = 6;
    const S = 4; // mesh quads per side
    const PX = 8; // pixels per tile
    const tileA = makeOracleTile(PX, (i, j) => 100 + i * 3 + j * 7);
    const tileB = makeOracleTile(PX, (i, j) => 250 + i * 2 + j * 5);
    // Neighbours one step further out are only needed to resolve tile A's own
    // west edge and tile B's own east edge (each mesh's full n×n grid touches
    // its own outer boundary too); their exact values don't matter here.
    const filler = makeOracleTile(PX, () => 0);
    const loader: TileLoader = (z, x, y) => {
      if (z !== Z) return Promise.reject(new Error(`unexpected tile ${z}/${x}/${y}`));
      if (y === 0 && x === 10) return Promise.resolve(tileA);
      if (y === 0 && x === 11) return Promise.resolve(tileB);
      return Promise.resolve(filler); // any other neighbour touched by the grid's own outer boundary
    };

    async function meshForTileX(x: number) {
      const oracle = new HeightOracle(Z, loader, PX);
      const n = S + 1;
      const grid = new Float32Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const gx = x * PX + (i / S) * PX;
          const gy = 0 * PX + (j / S) * PX;
          grid[j * n + i] = await oracle.height(gx, gy);
        }
      }
      const heightAt = (u: number, v: number): number =>
        grid[Math.round(v * S) * n + Math.round(u * S)] ?? 0;
      return buildTerrainMesh({ heightAt, widthM: 100, depthM: 100, segments: S });
    }

    const meshA = await meshForTileX(10); // tile A is west of tile B
    const meshB = await meshForTileX(11);
    const n = S + 1;
    for (let j = 0; j < n; j++) {
      const aEast = meshA.positions[(j * n + S) * 3 + 1];
      const bWest = meshB.positions[(j * n + 0) * 3 + 1];
      expect(aEast).toBe(bWest); // both went through the same H_z formula on the same global inputs
    }
  });

  it("pins a fine tile's rim edge exactly onto the coarser mesh's piecewise-linear edge", () => {
    // A coarse mesh built from a smooth (non-linear away from its own edge) height field.
    const coarseS = 4;
    const coarseMesh = buildTerrainMesh({
      heightAt: (u, v) => 1000 * u + 300 * v * v,
      widthM: 1000,
      depthM: 1000,
      segments: coarseS,
    });
    const coarseEdge = Array.from(
      { length: coarseS + 1 },
      (_unused, i) => coarseMesh.positions[i * 3 + 1] ?? 0,
    );

    const fineS = 8; // this fine tile's north edge spans the whole coarse edge (quads = coarseS, ratio 2)
    const fineMesh = buildTerrainMesh({
      heightAt: () => -12345, // must be fully overridden by the rim on the north edge
      widthM: 500,
      depthM: 500,
      segments: fineS,
      rim: { north: { quads: coarseS, heightAt: (k) => coarseEdge[k] ?? 0 } },
    });

    // Exactly at coarse vertices (fineS / coarseS = 2 fine vertices per coarse quad).
    for (let k = 0; k <= coarseS; k++) {
      const i = (k * fineS) / coarseS;
      expect(fineMesh.positions[i * 3 + 1]).toBeCloseTo(coarseEdge[k] ?? 0, 9);
    }
    // And between coarse vertices: piecewise-linear interpolation, not the underlying quadratic.
    for (let i = 0; i <= fineS; i++) {
      const t = (i * coarseS) / fineS;
      const k = Math.min(coarseS - 1, Math.floor(t));
      const f = t - k;
      const h0 = coarseEdge[k] ?? 0;
      const h1 = coarseEdge[k + 1] ?? 0;
      expect(fineMesh.positions[i * 3 + 1]).toBeCloseTo(h0 + (h1 - h0) * f, 9);
    }
  });

  it("applies rim overrides to west/east edges indexed north→south", () => {
    const coarseS = 4;
    const coarseMesh = buildTerrainMesh({
      heightAt: (u, v) => 50 * v + 400 * u * u,
      widthM: 1000,
      depthM: 1000,
      segments: coarseS,
    });
    const n = coarseS + 1;
    // west edge (i = 0) heights, north→south
    const coarseWestEdge = Array.from(
      { length: n },
      (_unused, j) => coarseMesh.positions[j * n * 3 + 1] ?? 0,
    );

    const fineS = 8;
    const fineMesh = buildTerrainMesh({
      heightAt: () => -1,
      widthM: 500,
      depthM: 500,
      segments: fineS,
      rim: { west: { quads: coarseS, heightAt: (k) => coarseWestEdge[k] ?? 0 } },
    });
    const fn = fineS + 1;
    for (let k = 0; k <= coarseS; k++) {
      const j = (k * fineS) / coarseS;
      expect(fineMesh.positions[j * fn * 3 + 1]).toBeCloseTo(coarseWestEdge[k] ?? 0, 9);
    }
  });
});

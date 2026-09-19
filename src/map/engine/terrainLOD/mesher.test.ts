// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

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
});

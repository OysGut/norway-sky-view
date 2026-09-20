// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import { sampleBilinear } from "../terrain/terrarium";
import { HeightOracle, rimEdgeGeometry, type OracleTile, type TileLoader } from "./heightOracle";

function makeOracleTile(
  width: number,
  height: number,
  valueAt: (i: number, j: number) => number,
): OracleTile {
  const heights = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) heights[j * width + i] = valueAt(i, j);
  }
  return { width, height, heights };
}

describe("HeightOracle", () => {
  // Two 4×4 tiles side by side at zoom 5, row y = 2: tile x = 3 (west) and x = 4 (east).
  const Z = 5;
  const TILE_SIZE = 4;
  const west = makeOracleTile(TILE_SIZE, TILE_SIZE, (i, j) => i + j * 10);
  const east = makeOracleTile(TILE_SIZE, TILE_SIZE, (i, j) => 100 + i + j * 10);

  function makeLoader(): TileLoader {
    return (z, x, y) => {
      if (z === Z && y === 2 && x === 3) return Promise.resolve(west);
      if (z === Z && y === 2 && x === 4) return Promise.resolve(east);
      return Promise.reject(new Error(`unexpected tile fetch ${z}/${x}/${y}`));
    };
  }

  it("matches plain bilinear for an interior sample (no tile boundary crossed)", async () => {
    const oracle = new HeightOracle(Z, makeLoader(), TILE_SIZE);
    // global pixel coords inside tile x = 3 (which spans gx ∈ [12, 16)): px = 1.0, py = 0.5
    const gx = 12 + 1.0;
    const gy = 2 * TILE_SIZE + 0.5;
    const got = await oracle.height(gx, gy);
    const expected = sampleBilinear(west.heights, TILE_SIZE, TILE_SIZE, 1.0, 0.5);
    expect(got).toBeCloseTo(expected, 10);
  });

  it("blends across a tile boundary to the mean of the two edge pixels", async () => {
    const oracle = new HeightOracle(Z, makeLoader(), TILE_SIZE);
    // gx = 16 is exactly the boundary between tile x=3 (last pixel centre 15.5) and
    // tile x=4 (first pixel centre 16.5): the boundary sits midway between them.
    const gy = 2 * TILE_SIZE + 0.5; // row j = 0 in both tiles
    const got = await oracle.height(16, gy);
    const leftEdge = west.heights[0 * TILE_SIZE + 3] ?? NaN; // (i=3, j=0) = 3
    const rightEdge = east.heights[0 * TILE_SIZE + 0] ?? NaN; // (i=0, j=0) = 100
    expect(got).toBeCloseTo((leftEdge + rightEdge) / 2, 10);
  });

  it("returns a pixel's own value exactly at its pixel-centre coordinate", async () => {
    const oracle = new HeightOracle(Z, makeLoader(), TILE_SIZE);
    const gx = 3 * TILE_SIZE + 2 + 0.5; // pixel (i=2, j=1) of tile x=3
    const gy = 2 * TILE_SIZE + 1 + 0.5;
    const got = await oracle.height(gx, gy);
    expect(got).toBeCloseTo(west.heights[1 * TILE_SIZE + 2] ?? NaN, 10);
  });

  it("clamps sea-level (h < 0) per pixel before interpolating", async () => {
    const negative = makeOracleTile(2, 2, () => -50);
    const loader: TileLoader = (z, x, y) =>
      z === 9 && x === 0 && y === 0
        ? Promise.resolve(negative)
        : Promise.reject(new Error("unexpected"));
    const oracle = new HeightOracle(9, loader, 2);
    const got = await oracle.height(1, 1);
    expect(got).toBe(0);
  });

  it("wraps the global x pixel coordinate around the world", async () => {
    // zoom 5 has 32 tiles per side; asking for x = -1 should wrap to x = 31.
    const wrapped = makeOracleTile(2, 2, () => 42);
    const loader: TileLoader = (z, x, y) =>
      z === 5 && x === 31 && y === 0
        ? Promise.resolve(wrapped)
        : Promise.reject(new Error(`no tile ${x}/${y}`));
    const oracle = new HeightOracle(5, loader, 2);
    const got = await oracle.height(-1, 0.5); // gx = -1 → wraps to the last tile's rightmost pixel
    expect(got).toBe(42);
  });
});

describe("rimEdgeGeometry", () => {
  const fine = { zoom: 13, x: 5, y: 9, segments: 64 };
  const coarse = { zoom: 11, segments: 64 };

  it("spans S / 2^Δz coarse quads", () => {
    expect(rimEdgeGeometry(fine, coarse, "north").quads).toBe(16);
  });

  it("places the north edge along one coarse row, columns advancing west→east", () => {
    const geo = rimEdgeGeometry(fine, coarse, "north");
    // xc = floor(5/4) = 1, yc = floor(9/4) = 2; local offset (5-4, 9-8) = (1, 1) of 4 ⇒ colWest = rowNorth = 16
    expect(geo.pixelAt(0)).toEqual({ gx: 1 * 256 + 16 * 4, gy: 2 * 256 + 16 * 4 });
    expect(geo.pixelAt(16)).toEqual({ gx: 1 * 256 + 32 * 4, gy: 2 * 256 + 16 * 4 });
  });

  it("places the south edge one quads-row further down, same columns as north", () => {
    const north = rimEdgeGeometry(fine, coarse, "north");
    const south = rimEdgeGeometry(fine, coarse, "south");
    for (const k of [0, 8, 16]) {
      const n = north.pixelAt(k);
      const s = south.pixelAt(k);
      expect(s.gx).toBe(n.gx);
      expect(s.gy).toBe(n.gy + south.quads * 4);
    }
  });

  it("places the west and east edges along columns, rows advancing north→south", () => {
    const west = rimEdgeGeometry(fine, coarse, "west");
    const east = rimEdgeGeometry(fine, coarse, "east");
    expect(west.pixelAt(0)).toEqual({ gx: 1 * 256 + 16 * 4, gy: 2 * 256 + 16 * 4 });
    expect(west.pixelAt(16)).toEqual({ gx: 1 * 256 + 16 * 4, gy: 2 * 256 + 32 * 4 });
    expect(east.pixelAt(0)).toEqual({ gx: 1 * 256 + 32 * 4, gy: 2 * 256 + 16 * 4 });
  });

  it("agrees with the coarse tile's own vertex formula (origin·256 + (ic/S)·256)", () => {
    const geo = rimEdgeGeometry(fine, coarse, "north");
    const xc = Math.floor(fine.x / 4);
    const ic = 16 + 3; // colWest + k, k = 3
    const expectedGx = xc * 256 + (ic / coarse.segments) * 256;
    expect(geo.pixelAt(3).gx).toBeCloseTo(expectedGx, 10);
  });

  it("rejects a coarse zoom that isn't strictly below the fine zoom", () => {
    expect(() => rimEdgeGeometry(fine, { zoom: 13, segments: 64 }, "north")).toThrow();
    expect(() => rimEdgeGeometry(fine, { zoom: 14, segments: 64 }, "north")).toThrow();
  });

  it("rejects mismatched segment counts", () => {
    expect(() => rimEdgeGeometry(fine, { zoom: 11, segments: 32 }, "north")).toThrow();
  });
});

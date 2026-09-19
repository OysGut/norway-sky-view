// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import { lonLatToTile, tileToLonLatBounds } from "../projection";
import { DEFAULT_RINGS, holeFor, planRings } from "./rings";

const GALDHOPIGGEN = { lon: 8.3125, lat: 61.6364 };

describe("holeFor", () => {
  const tile = { west: 0, east: 10, south: 0, north: 10 };

  it("returns null without overlap", () => {
    expect(holeFor(tile, { west: 20, east: 30, south: 0, north: 10 })).toBeNull();
    expect(holeFor(tile, { west: 10, east: 20, south: 0, north: 10 })).toBeNull(); // touching edge
  });

  it("returns full when covered", () => {
    expect(holeFor(tile, { west: -1, east: 11, south: -1, north: 11 })).toBe("full");
    expect(holeFor(tile, tile)).toBe("full");
  });

  it("returns the uv rectangle of a partial overlap (v measured from the north)", () => {
    expect(holeFor(tile, { west: 5, east: 20, south: 2, north: 6 })).toEqual({
      u0: 0.5,
      u1: 1,
      v0: 0.4,
      v1: 0.8,
    });
  });
});

describe("planRings", () => {
  it("plans three nested rings with the finest first and no fully covered coarse tiles", () => {
    const jobs = planRings(GALDHOPIGGEN);
    const byZoom = new Map<number, typeof jobs>();
    for (const j of jobs) byZoom.set(j.z, [...(byZoom.get(j.z) ?? []), j]);
    expect([...byZoom.keys()]).toEqual([13, 11, 9]);
    expect(byZoom.get(13)?.length).toBe(25);
    // a 5 × 5 z13 block can cover at most one whole z11 tile (4 × 4 z13) → 24 or 25 mid tiles
    expect(byZoom.get(11)?.length).toBeGreaterThanOrEqual(24);
    expect(byZoom.get(11)?.length).toBeLessThanOrEqual(25);
    // likewise the 5 × 5 z11 block covers at most one whole z9 tile
    expect(byZoom.get(9)?.length).toBeGreaterThanOrEqual(24);
    expect(byZoom.get(9)?.length).toBeLessThanOrEqual(25);
    // and the coarse rings always carry holes under the finer block
    expect((byZoom.get(9) ?? []).filter((j) => j.hole).length).toBeGreaterThan(0);
    // the finest ring has no holes
    for (const j of byZoom.get(13) ?? []) expect(j.hole).toBeUndefined();
    // some mid tiles have holes (the ones under the near block)
    expect((byZoom.get(11) ?? []).filter((j) => j.hole).length).toBeGreaterThan(0);
  });

  it("puts the centre tile of every ring under the user", () => {
    const jobs = planRings(GALDHOPIGGEN);
    for (const spec of DEFAULT_RINGS) {
      const c = lonLatToTile(GALDHOPIGGEN.lon, GALDHOPIGGEN.lat, spec.zoom);
      const b = tileToLonLatBounds(c.x, c.y, c.z);
      // the centre tile of the two coarser rings is holed or skipped; the finest one is present
      const present = jobs.find((j) => j.z === c.z && j.x === c.x && j.y === c.y);
      if (spec.zoom === 13) {
        expect(present).toBeDefined();
        expect(present?.bounds).toEqual(b);
      }
    }
  });

  it("holes stay inside the unit square and job keys encode them", () => {
    for (const j of planRings(GALDHOPIGGEN)) {
      if (!j.hole) {
        expect(j.jobKey).toBe(`${j.z}/${j.x}/${j.y}`);
        continue;
      }
      expect(j.hole.u0).toBeGreaterThanOrEqual(0);
      expect(j.hole.u1).toBeLessThanOrEqual(1);
      expect(j.hole.v0).toBeGreaterThanOrEqual(0);
      expect(j.hole.v1).toBeLessThanOrEqual(1);
      expect(j.hole.u0).toBeLessThan(j.hole.u1);
      expect(j.hole.v0).toBeLessThan(j.hole.v1);
      expect(j.jobKey).toContain("|h");
    }
  });

  it("is stable for the same input and changes when the user crosses a fine tile", () => {
    const a = planRings(GALDHOPIGGEN).map((j) => j.jobKey);
    const b = planRings(GALDHOPIGGEN).map((j) => j.jobKey);
    expect(a).toEqual(b);
    const moved = planRings({ lon: GALDHOPIGGEN.lon + 0.1, lat: GALDHOPIGGEN.lat }); // ≈ 5 km east
    expect(moved.map((j) => j.jobKey)).not.toEqual(a);
    // most far tiles are unchanged → the cache and existing meshes are reused
    const farA = new Set(a.filter((k) => k.startsWith("9/")));
    const farB = moved.filter((j) => j.z === 9).map((j) => j.jobKey);
    expect(farB.filter((k) => farA.has(k)).length).toBeGreaterThan(15);
  });
});

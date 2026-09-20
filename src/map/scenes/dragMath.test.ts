import { describe, expect, it } from "vitest";

import { groundHit, sceneDeltaToEnu, toNdc } from "./dragMath";

describe("dragMath", () => {
  it("hits the ground plane along a downward ray and rejects the rest", () => {
    const hit = groundHit({ x: 0, y: 1000, z: 0 }, { x: 0, y: -1, z: -1 }, 10_000);
    expect(hit).toEqual({ x: 0, y: 0, z: -1000 });
    expect(groundHit({ x: 0, y: 1000, z: 0 }, { x: 0, y: 0.1, z: -1 }, 10_000)).toBeNull();
    expect(groundHit({ x: 0, y: 1000, z: 0 }, { x: 0, y: -0.01, z: -1 }, 10_000)).toBeNull(); // 100 km away
  });

  it("maps scene deltas to ENU for the heading", () => {
    // heading 0: scene -z is north, +x is east
    expect(sceneDeltaToEnu(10, -20, 0).east).toBeCloseTo(10, 9);
    expect(sceneDeltaToEnu(10, -20, 0).north).toBeCloseTo(20, 9);
    // heading 90: forward is east, right is south
    const e = sceneDeltaToEnu(10, -20, 90);
    expect(e.east).toBeCloseTo(20, 9);
    expect(e.north).toBeCloseTo(-10, 9);
  });

  it("converts pixels to NDC", () => {
    expect(toNdc(0, 0, 200, 100)).toEqual({ x: -1, y: 1 });
    expect(toNdc(200, 100, 200, 100)).toEqual({ x: 1, y: -1 });
    expect(toNdc(100, 50, 200, 100)).toEqual({ x: 0, y: 0 });
  });
});

// LOCKED: engine code — modify only on explicit engine tasks.
import { describe, expect, it } from "vitest";

import {
  enuToLonLat,
  lonLatToEnu,
  lonLatToTile,
  lonLatToTilePixel,
  metersPerPixel,
  tileSizeMeters,
  tileToLonLatBounds,
} from "./index";

const GALDHOPIGGEN = { lon: 8.3125, lat: 61.6364 };
const SOGNEFJORDEN = { lon: 6.523, lat: 61.087 };

describe("lonLatToTile", () => {
  it("addresses Galdhøpiggen at z=12", () => {
    expect(lonLatToTile(GALDHOPIGGEN.lon, GALDHOPIGGEN.lat, 12)).toEqual({
      z: 12,
      x: 2142,
      y: 1151,
    });
  });

  it("addresses Sognefjorden at z=12", () => {
    expect(lonLatToTile(SOGNEFJORDEN.lon, SOGNEFJORDEN.lat, 12)).toEqual({
      z: 12,
      x: 2122,
      y: 1164,
    });
  });

  it("matches the tile used by the data spike at z=8", () => {
    // 61.2 N, 7.73 E is the centre of the spike tile 8/133/72
    expect(lonLatToTile(7.73, 61.2, 8)).toEqual({ z: 8, x: 133, y: 72 });
  });

  it("clamps at the poles and the antimeridian", () => {
    expect(lonLatToTile(180, 89, 3)).toEqual({ z: 3, x: 7, y: 0 });
    expect(lonLatToTile(-180, -89, 3)).toEqual({ z: 3, x: 0, y: 7 });
  });
});

describe("lonLatToTilePixel", () => {
  it("gives a fractional pixel inside the tile", () => {
    const p = lonLatToTilePixel(GALDHOPIGGEN.lon, GALDHOPIGGEN.lat, 12);
    expect(p.x).toBe(2142);
    expect(p.y).toBe(1151);
    expect(p.px).toBeCloseTo(147.9, 0);
    expect(p.py).toBeCloseTo(72.1, 0);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThan(256);
  });
});

describe("tileToLonLatBounds", () => {
  it("contains the point that addressed the tile", () => {
    for (const z of [6, 10, 12, 14]) {
      const t = lonLatToTile(GALDHOPIGGEN.lon, GALDHOPIGGEN.lat, z);
      const b = tileToLonLatBounds(t.x, t.y, z);
      expect(b.west).toBeLessThanOrEqual(GALDHOPIGGEN.lon);
      expect(b.east).toBeGreaterThan(GALDHOPIGGEN.lon);
      expect(b.south).toBeLessThanOrEqual(GALDHOPIGGEN.lat);
      expect(b.north).toBeGreaterThan(GALDHOPIGGEN.lat);
    }
  });

  it("covers the world at z=0", () => {
    const b = tileToLonLatBounds(0, 0, 0);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
    expect(b.north).toBeCloseTo(85.0511, 3);
    expect(b.south).toBeCloseTo(-85.0511, 3);
  });

  it("tiles the width of the world evenly", () => {
    const a = tileToLonLatBounds(3, 3, 3);
    const b = tileToLonLatBounds(4, 3, 3);
    expect(a.east).toBeCloseTo(b.west, 10);
    expect(a.east - a.west).toBeCloseTo(45, 10);
  });
});

describe("metersPerPixel", () => {
  it("is ≈ 18.2 m at Galdhøpiggen, z=12", () => {
    expect(metersPerPixel(GALDHOPIGGEN.lat, 12)).toBeCloseTo(18.16, 1);
  });

  it("halves per zoom level", () => {
    const a = metersPerPixel(60, 10);
    const b = metersPerPixel(60, 11);
    expect(a / b).toBeCloseTo(2, 10);
  });

  it("tile ground size is 256 × pixel size", () => {
    expect(tileSizeMeters(GALDHOPIGGEN.lat, 12)).toBeCloseTo(
      metersPerPixel(GALDHOPIGGEN.lat, 12) * 256,
      6,
    );
  });
});

describe("ENU frame", () => {
  it("round-trips", () => {
    const off = lonLatToEnu(GALDHOPIGGEN, SOGNEFJORDEN);
    const back = enuToLonLat(GALDHOPIGGEN, off);
    expect(back.lon).toBeCloseTo(SOGNEFJORDEN.lon, 9);
    expect(back.lat).toBeCloseTo(SOGNEFJORDEN.lat, 9);
  });

  it("has sensible magnitudes at 61° N", () => {
    const oneDegNorth = lonLatToEnu(GALDHOPIGGEN, {
      lon: GALDHOPIGGEN.lon,
      lat: GALDHOPIGGEN.lat + 1,
    });
    const oneDegEast = lonLatToEnu(GALDHOPIGGEN, {
      lon: GALDHOPIGGEN.lon + 1,
      lat: GALDHOPIGGEN.lat,
    });
    expect(oneDegNorth.north).toBeCloseTo(111_133, -2);
    expect(oneDegNorth.east).toBe(0);
    expect(oneDegEast.east).toBeGreaterThan(52_000);
    expect(oneDegEast.east).toBeLessThan(54_000);
    expect(oneDegEast.north).toBe(0);
  });
});

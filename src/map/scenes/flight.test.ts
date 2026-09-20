import { describe, expect, it } from "vitest";

import {
  cruiseHeight,
  easeInOutCubic,
  flightDuration,
  greatCircleDistance,
  planFlight,
  sampleFlight,
} from "./flight";

const GALDHOPIGGEN = { lat: 61.6364, lon: 8.3125 };
const TROMSO = { lat: 69.6496, lon: 18.956 };
const SOGNEFJORDEN = { lat: 61.17, lon: 6.56 };

describe("flight", () => {
  it("measures distances on the sphere", () => {
    expect(greatCircleDistance(GALDHOPIGGEN, GALDHOPIGGEN)).toBe(0);
    const d = greatCircleDistance(GALDHOPIGGEN, TROMSO);
    expect(d).toBeGreaterThan(1_000_000);
    expect(d).toBeLessThan(1_100_000);
    expect(greatCircleDistance(GALDHOPIGGEN, SOGNEFJORDEN)).toBeCloseTo(107_000, -4);
  });

  it("times flights: quick hops, capped cross-country flights", () => {
    expect(flightDuration(0)).toBe(0);
    expect(flightDuration(500)).toBeCloseTo(704, 6);
    expect(flightDuration(100_000)).toBe(1500);
    expect(flightDuration(5_000_000)).toBe(9000);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("climbs for long flights but never above the ceiling", () => {
    expect(cruiseHeight(1000, 1200, 1200, 100_000)).toBe(1200);
    expect(cruiseHeight(100_000, 1200, 1200, 100_000)).toBe(30_000);
    expect(cruiseHeight(1_000_000, 1200, 1200, 100_000)).toBe(100_000);
    expect(cruiseHeight(1000, 1200, 5000, 100_000)).toBe(5000);
  });

  it("starts where it left, lands where it should, and peaks in between", () => {
    const f = planFlight(GALDHOPIGGEN, TROMSO, {
      now: 1000,
      fromHeight: 1200,
      fromHeading: 350,
      toHeading: 20,
      maxHeight: 100_000,
    });
    const start = sampleFlight(f, 1000);
    expect(start.point).toEqual(GALDHOPIGGEN);
    expect(start.height).toBeCloseTo(1200, 6);
    expect(start.heading).toBeCloseTo(350, 6);
    expect(start.done).toBe(false);

    const mid = sampleFlight(f, 1000 + f.durationMs / 2);
    expect(mid.height).toBeCloseTo(100_000, 3);
    expect(mid.point.lat).toBeCloseTo((GALDHOPIGGEN.lat + TROMSO.lat) / 2, 6);
    // heading takes the short way round: 350 → 20 passes through 5, not 185
    expect(mid.heading).toBeCloseTo(5, 6);

    const end = sampleFlight(f, 1000 + f.durationMs + 50);
    expect(end.point.lat).toBeCloseTo(TROMSO.lat, 9);
    expect(end.point.lon).toBeCloseTo(TROMSO.lon, 9);
    expect(end.height).toBeCloseTo(1200, 6);
    expect(end.heading).toBeCloseTo(20, 6);
    expect(end.done).toBe(true);
  });

  it("keeps the height when hopping next door", () => {
    const f = planFlight(
      GALDHOPIGGEN,
      { lat: 61.64, lon: 8.32 },
      {
        now: 0,
        fromHeight: 1200,
        fromHeading: 0,
        maxHeight: 100_000,
      },
    );
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleFlight(f, t * f.durationMs).height).toBeCloseTo(1200, 6);
    }
  });
});

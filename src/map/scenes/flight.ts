// Fly-to: a smooth, self-timed flight of the user point from A to B with a
// height arc (climb, cruise, descend). Pure functions — the scene samples the
// flight every frame and writes the result into mapStore.

import type { LonLat } from "../engine/projection";

export interface Flight {
  from: LonLat;
  to: LonLat;
  /** camera height above ground at departure / arrival, metres */
  fromHeight: number;
  toHeight: number;
  /** highest point of the arc, metres above ground */
  peakHeight: number;
  fromHeading: number;
  toHeading: number;
  startMs: number;
  durationMs: number;
}

export interface FlightSample {
  point: LonLat;
  height: number;
  heading: number;
  /** 0..1 progress */
  t: number;
  done: boolean;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG2RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function greatCircleDistance(a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const la = a.lat * DEG2RAD;
  const lb = b.lat * DEG2RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Smooth ease-in/out (cubic). */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface FlightOptions {
  now: number;
  fromHeight: number;
  fromHeading: number;
  /** arrival height; defaults to the departure height */
  toHeight?: number | undefined;
  /** arrival heading; defaults to the departure heading */
  toHeading?: number | undefined;
  /** highest height the arc may reach */
  maxHeight: number;
}

/** Flight duration: quick for short hops, capped for cross-country flights. */
export function flightDuration(distanceM: number): number {
  if (distanceM < 1) return 0;
  return Math.min(9000, Math.max(700, 700 + (distanceM / 1000) * 8));
}

/** Cruise height for a distance: climb enough to see where you are going, never above `maxHeight`. */
export function cruiseHeight(
  distanceM: number,
  fromHeight: number,
  toHeight: number,
  maxHeight: number,
): number {
  const wanted = Math.max(fromHeight, toHeight, distanceM * 0.3);
  return Math.min(maxHeight, wanted);
}

export function planFlight(from: LonLat, to: LonLat, o: FlightOptions): Flight {
  const distance = greatCircleDistance(from, to);
  const toHeight = o.toHeight ?? o.fromHeight;
  return {
    from: { ...from },
    to: { ...to },
    fromHeight: o.fromHeight,
    toHeight,
    peakHeight: cruiseHeight(distance, o.fromHeight, toHeight, o.maxHeight),
    fromHeading: o.fromHeading,
    toHeading: o.toHeading ?? o.fromHeading,
    startMs: o.now,
    durationMs: flightDuration(distance),
  };
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (((a + delta * t) % 360) + 360) % 360;
}

/** Where the flight is at `nowMs`. Position eases in/out; height follows a bell over the base line. */
export function sampleFlight(f: Flight, nowMs: number): FlightSample {
  const raw = f.durationMs <= 0 ? 1 : (nowMs - f.startMs) / f.durationMs;
  const t = Math.min(1, Math.max(0, raw));
  const s = easeInOutCubic(t);
  // shortest way around for longitude (Norway never crosses the antimeridian, but be safe)
  const dLon = ((f.to.lon - f.from.lon + 540) % 360) - 180;
  const point = { lat: f.from.lat + (f.to.lat - f.from.lat) * s, lon: f.from.lon + dLon * s };
  const base = f.fromHeight + (f.toHeight - f.fromHeight) * s;
  const height = base + (f.peakHeight - base) * Math.sin(Math.PI * t);
  return {
    point,
    height,
    heading: lerpAngleDeg(f.fromHeading, f.toHeading, s),
    t,
    done: t >= 1,
  };
}

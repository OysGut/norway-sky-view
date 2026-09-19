// NOAA SWPC OVATION aurora forecast via proxy-fetch.
// The proxy's `slim=north` option drops everything south of 45° N (≈ 920 kB → a few kB).

import { proxyFetchJson, type ProxyResult } from "./proxy";

/** [longitude 0..359, latitude, probability 0..100] */
export type AuroraPoint = [lon: number, lat: number, probability: number];

export interface AuroraForecast {
  observationTime: string;
  forecastTime: string;
  points: AuroraPoint[];
}

interface OvationRaw {
  "Observation Time"?: string;
  "Forecast Time"?: string;
  coordinates?: unknown[];
}

export const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

export function mapOvation(raw: OvationRaw): AuroraForecast {
  const points: AuroraPoint[] = [];
  for (const c of raw.coordinates ?? []) {
    if (
      Array.isArray(c) &&
      typeof c[0] === "number" &&
      typeof c[1] === "number" &&
      typeof c[2] === "number"
    ) {
      points.push([c[0], c[1], c[2]]);
    }
  }
  return {
    observationTime: raw["Observation Time"] ?? "",
    forecastTime: raw["Forecast Time"] ?? "",
    points,
  };
}

export async function fetchAuroraNorth(): Promise<ProxyResult<AuroraForecast>> {
  const result = await proxyFetchJson<OvationRaw>(`${OVATION_URL}?slim=north`);
  return { ...result, data: mapOvation(result.data) };
}

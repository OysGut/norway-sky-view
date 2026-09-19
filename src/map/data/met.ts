// MET Norway Locationforecast 2.0 (compact) via proxy-fetch.
// https://api.met.no/weatherapi/locationforecast/2.0/documentation
// MET requires ≤ 4 decimals on coordinates and an identifying User-Agent (set by the proxy).

import { proxyFetchJson, type ProxyResult } from "./proxy";

export interface ForecastStep {
  time: string;
  airTemperature: number | null;
  windSpeed: number | null;
  windFromDirection: number | null;
  cloudAreaFraction: number | null;
  relativeHumidity: number | null;
  precipitationNextHour: number | null;
  symbolNextHour: string | null;
}

export interface LocationForecast {
  updatedAt: string;
  /** Model terrain altitude at the point, metres (from geometry.coordinates[2]). */
  altitude: number | null;
  series: ForecastStep[];
}

interface MetCompact {
  geometry?: { coordinates?: unknown[] };
  properties?: {
    meta?: { updated_at?: string };
    timeseries?: Array<{
      time: string;
      data?: {
        instant?: { details?: Record<string, number | undefined> };
        next_1_hours?: {
          summary?: { symbol_code?: string };
          details?: { precipitation_amount?: number };
        };
      };
    }>;
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function roundCoordinate(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

export function locationForecastUrl(lat: number, lon: number): string {
  return `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${roundCoordinate(lat)}&lon=${roundCoordinate(lon)}`;
}

export function mapLocationForecast(raw: MetCompact): LocationForecast {
  const coords = raw.geometry?.coordinates ?? [];
  const series: ForecastStep[] = (raw.properties?.timeseries ?? []).map((step) => {
    const inst = step.data?.instant?.details ?? {};
    const next = step.data?.next_1_hours;
    return {
      time: step.time,
      airTemperature: num(inst["air_temperature"]),
      windSpeed: num(inst["wind_speed"]),
      windFromDirection: num(inst["wind_from_direction"]),
      cloudAreaFraction: num(inst["cloud_area_fraction"]),
      relativeHumidity: num(inst["relative_humidity"]),
      precipitationNextHour: num(next?.details?.precipitation_amount),
      symbolNextHour: next?.summary?.symbol_code ?? null,
    };
  });
  return {
    updatedAt: raw.properties?.meta?.updated_at ?? "",
    altitude: num(coords[2]),
    series,
  };
}

export async function fetchLocationForecast(
  lat: number,
  lon: number,
): Promise<ProxyResult<LocationForecast>> {
  const result = await proxyFetchJson<MetCompact>(locationForecastUrl(lat, lon));
  return { ...result, data: mapLocationForecast(result.data) };
}

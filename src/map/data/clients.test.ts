import { describe, expect, it } from "vitest";

import { locationForecastUrl, mapLocationForecast, roundCoordinate } from "./met";
import { mapOvation } from "./noaa";

describe("met", () => {
  it("rounds coordinates to 4 decimals as MET requires", () => {
    expect(roundCoordinate(61.63641234)).toBe(61.6364);
    expect(locationForecastUrl(61.63641234, 8.31249999)).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=61.6364&lon=8.3125",
    );
  });

  it("maps the compact response to a narrow shape", () => {
    const mapped = mapLocationForecast({
      geometry: { coordinates: [8.3125, 61.6364, 2433] },
      properties: {
        meta: { updated_at: "2026-09-19T18:00:00Z" },
        timeseries: [
          {
            time: "2026-09-19T19:00:00Z",
            data: {
              instant: {
                details: {
                  air_temperature: -2.1,
                  wind_speed: 7.3,
                  wind_from_direction: 250,
                  cloud_area_fraction: 12.5,
                },
              },
              next_1_hours: {
                summary: { symbol_code: "clearsky_night" },
                details: { precipitation_amount: 0 },
              },
            },
          },
          { time: "2026-09-19T20:00:00Z" },
        ],
      },
    });
    expect(mapped.updatedAt).toBe("2026-09-19T18:00:00Z");
    expect(mapped.altitude).toBe(2433);
    expect(mapped.series).toHaveLength(2);
    expect(mapped.series[0]).toEqual({
      time: "2026-09-19T19:00:00Z",
      airTemperature: -2.1,
      windSpeed: 7.3,
      windFromDirection: 250,
      cloudAreaFraction: 12.5,
      relativeHumidity: null,
      precipitationNextHour: 0,
      symbolNextHour: "clearsky_night",
    });
    expect(mapped.series[1]?.airTemperature).toBeNull();
    expect(mapped.series[1]?.symbolNextHour).toBeNull();
  });
});

describe("noaa", () => {
  it("keeps only well-formed points", () => {
    const mapped = mapOvation({
      "Observation Time": "a",
      "Forecast Time": "b",
      coordinates: [[10, 65, 12], [11, "x", 3], [12, 66], "junk"],
    });
    expect(mapped.observationTime).toBe("a");
    expect(mapped.points).toEqual([[10, 65, 12]]);
  });
});

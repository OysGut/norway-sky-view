import { describe, expect, it } from "vitest";

import { formatCoordinate, formatDate, formatMeters, formatNumber, formatTime } from "./format";

const stripSpaces = (value: string) => value.replace(/[\u00A0\u202F\s]/g, " ");

describe("formatNumber", () => {
  it("groups thousands per locale", () => {
    expect(stripSpaces(formatNumber(2469, 0, "nb"))).toBe("2 469");
    expect(formatNumber(2469, 0, "en")).toBe("2,469");
  });

  it("respects maximum fraction digits", () => {
    expect(formatNumber(3.14159, 2, "en")).toBe("3.14");
    expect(formatNumber(3.14159, 2, "nb")).toBe("3,14");
  });
});

describe("formatMeters", () => {
  it("appends the unit", () => {
    expect(stripSpaces(formatMeters(2469, "nb"))).toBe("2 469 m");
    expect(stripSpaces(formatMeters(2469, "en"))).toBe("2,469 m");
  });
});

describe("formatCoordinate", () => {
  it("uses locale decimals and hemisphere letters", () => {
    expect(formatCoordinate(61.6364, 8.3125, "nb")).toBe("61,6364° N, 8,3125° Ø");
    expect(formatCoordinate(61.6364, 8.3125, "en")).toBe("61.6364° N, 8.3125° E");
    expect(formatCoordinate(-33.5, -70.25, "en")).toBe("33.5000° S, 70.2500° W");
  });
});

describe("formatTime", () => {
  it("formats 24-hour time in both languages", () => {
    const date = new Date(2026, 8, 19, 14, 32);
    expect(formatTime(date, "nb")).toBe("14:32");
    expect(formatTime(date, "en")).toBe("14:32");
  });
});

describe("formatDate", () => {
  it("formats long dates per locale", () => {
    const date = new Date(2026, 8, 19);
    expect(formatDate(date, "nb")).toBe("19. september 2026");
    expect(formatDate(date, "en")).toBe("19 September 2026");
  });
});

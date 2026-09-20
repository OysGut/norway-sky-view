import { describe, expect, it } from "vitest";

import { lonLatToEnu } from "../engine/projection";
import { DEFAULT_VIEW_SETTINGS } from "../store/mapStore";

import { lookAheadMeters } from "./cameraModel";
import { pivotDistance, turnTo, userPointForTurn } from "./rotation";

const USER = { lat: 61.6364, lon: 8.3125 };

function state(overrides: Record<string, unknown> = {}) {
  return {
    mode: "bent" as const,
    userPoint: USER,
    heading: 0,
    groundHeight: 0,
    ...DEFAULT_VIEW_SETTINGS.bent,
    ...overrides,
  };
}

describe("rotation pivot", () => {
  it("pivots on the screen-centre ground point in the Himinrond view", () => {
    const s = state();
    const d = pivotDistance(s);
    // the user point sits at 0.3 of the screen; the centre is a little ahead, inside the flat zone
    const ahead = lookAheadMeters(1200, 0.3);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(ahead, 0);
  });

  it("pivots farther ahead when the user point is pushed below the screen", () => {
    const near = pivotDistance(state({ userPointScreenFraction: 0.3 }));
    const far = pivotDistance(state({ userPointScreenFraction: -0.5 }));
    expect(far).toBeGreaterThan(near * 2);
  });

  it("keeps the user point as pivot in classic 3D and top-down", () => {
    expect(pivotDistance(state({ mode: "classic3d", ...DEFAULT_VIEW_SETTINGS.classic3d }))).toBe(0);
    expect(pivotDistance(state({ mode: "2d", ...DEFAULT_VIEW_SETTINGS["2d"] }))).toBe(0);
  });

  it("moves the user so the pivot stays put while turning", () => {
    const d = 500;
    const turned = userPointForTurn(USER, 0, 90, d);
    // pivot before: 500 m north of the user; after: 500 m east of the new user point
    const before = { east: 0, north: d };
    const offset = lonLatToEnu(USER, turned);
    const after = {
      east: offset.east + d * Math.sin(Math.PI / 2),
      north: offset.north + d * Math.cos(Math.PI / 2),
    };
    expect(after.east).toBeCloseTo(before.east, 3);
    expect(after.north).toBeCloseTo(before.north, 3);
    // a full turn brings the user back
    const back = userPointForTurn(turned, 90, 0, d);
    expect(back.lat).toBeCloseTo(USER.lat, 5);
    expect(back.lon).toBeCloseTo(USER.lon, 5);
  });

  it("turnTo normalises the heading and leaves the user in place when the pivot is the user", () => {
    const r = turnTo(state({ mode: "classic3d", ...DEFAULT_VIEW_SETTINGS.classic3d }), 370);
    expect(r.heading).toBe(10);
    expect(r.userPoint).toEqual(USER);
  });
});

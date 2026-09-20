import { describe, expect, it } from "vitest";

import { CAMERA_FOV_DEG, cameraPose, lookAheadMeters } from "./cameraModel";

/** Screen fraction (from the bottom) at which a scene point appears for a pose. */
function screenFraction(pose: ReturnType<typeof cameraPose>, point: [number, number, number]) {
  const dir = [
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ];
  const toPoint = [
    point[0] - pose.position[0],
    point[1] - pose.position[1],
    point[2] - pose.position[2],
  ];
  const forward = dir.reduce((acc, d, i) => acc + d * (toPoint[i] ?? 0), 0);
  const up = pose.up.reduce((acc, u, i) => acc + u * (toPoint[i] ?? 0), 0);
  const halfTan = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  return 0.5 + up / forward / (2 * halfTan);
}

describe("cameraPose", () => {
  it("reproduces the straight-down Bent World camera at pitch 0", () => {
    const pose = cameraPose(1200, 0, 0.3);
    expect(pose.position[0]).toBe(0);
    expect(pose.position[1]).toBe(1200);
    expect(pose.position[2]).toBeCloseTo(-lookAheadMeters(1200, 0.3), 6);
    expect(pose.up).toEqual([0, 0, -1]);
    expect(pose.target[1]).toBeCloseTo(1199, 6);
  });

  it("keeps the user point at the requested screen fraction for any pitch", () => {
    for (const pitch of [0, 30, 55, 70, 80]) {
      for (const fraction of [0.1, 0.3, 0.5]) {
        const pose = cameraPose(1500, pitch, fraction);
        expect(screenFraction(pose, [0, 0, 0])).toBeCloseTo(fraction, 6);
      }
    }
  });

  it("looks toward north with the up vector perpendicular to the view direction", () => {
    const pose = cameraPose(1000, 70, 0.2);
    const dir = [
      pose.target[0] - pose.position[0],
      pose.target[1] - pose.position[1],
      pose.target[2] - pose.position[2],
    ];
    expect(dir[2]).toBeLessThan(0); // toward -z = north
    const dot = dir.reduce((acc, d, i) => acc + d * (pose.up[i] ?? 0), 0);
    expect(dot).toBeCloseTo(0, 9);
    // the camera sits south of the user point in classic 3D
    expect(pose.position[2]).toBeGreaterThan(0);
  });
});

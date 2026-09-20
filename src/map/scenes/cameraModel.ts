// Camera constants and pose shared by the Bent World scene and its UI.

import { lookAheadForComposition } from "../engine/bendMath";

export const CAMERA_FOV_DEG = 50;

/** Forward offset of the camera target that puts the user point at `fraction` of the screen height. */
export function lookAheadMeters(cameraHeightM: number, userPointScreenFraction: number): number {
  return lookAheadForComposition(cameraHeightM, {
    userPointScreenFraction,
    fovDeg: CAMERA_FOV_DEG,
  });
}

export interface CameraPose {
  /** scene units (x = east, y = up, z = -north) */
  position: [number, number, number];
  /** a point along the view direction, for lookAt */
  target: [number, number, number];
  up: [number, number, number];
}

/**
 * Camera pose for a camera at `heightM` above the ground under the user point
 * (the origin), tilted `pitchDeg` from straight down toward north, positioned so
 * that the user point sits at `userPointScreenFraction` of the screen height.
 *
 * pitch 0 reproduces the fixed top-down Bent World camera; pitch ≈ 70 is a
 * classic 3D look toward the horizon.
 */
export function cameraPose(
  heightM: number,
  pitchDeg: number,
  userPointScreenFraction: number,
): CameraPose {
  const phi = (pitchDeg * Math.PI) / 180;
  // angle below the view centre at which the user point should appear
  const alpha = Math.atan(
    (1 - 2 * userPointScreenFraction) * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360),
  );
  // camera sits south (+z) of the origin when it looks down-and-forward at it
  const z = heightM * Math.tan(phi - alpha);
  const dirY = -Math.cos(phi);
  const dirZ = -Math.sin(phi);
  return {
    position: [0, heightM, z],
    target: [0, heightM + dirY, z + dirZ],
    up: [0, Math.sin(phi), -Math.cos(phi)],
  };
}

/** mapStore.layers key that switches every terrain material to wireframe (debug/tuning). */
export const WIREFRAME_LAYER = "debug:wireframe";

/** mapStore.layers key that replaces fetched heights with procedural hills (offline testing). */
export const SYNTHETIC_LAYER = "debug:synthetic";

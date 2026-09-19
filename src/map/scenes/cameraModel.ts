// Camera constants shared by the Bent World scene and its UI.

import { lookAheadForComposition } from "@/map/engine/bendMath";

export const CAMERA_FOV_DEG = 50;

/** Forward offset of the camera target that puts the user point at `fraction` of the screen height. */
export function lookAheadMeters(cameraHeightM: number, userPointScreenFraction: number): number {
  return lookAheadForComposition(cameraHeightM, {
    userPointScreenFraction,
    fovDeg: CAMERA_FOV_DEG,
  });
}

/** mapStore.layers key that switches every terrain material to wireframe (debug/tuning). */
export const WIREFRAME_LAYER = "debug:wireframe";

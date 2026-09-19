// Camera constants shared by the Bent World scene and its UI.

export const CAMERA_FOV_DEG = 50;

/** Forward offset of the camera target that puts the user point at `fraction` of the screen height. */
export function lookAheadMeters(cameraHeightM: number, userPointScreenFraction: number): number {
  const halfHeight = cameraHeightM * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  return (0.5 - userPointScreenFraction) * 2 * halfHeight;
}

/** mapStore.layers key that switches every terrain material to wireframe (debug/tuning). */
export const WIREFRAME_LAYER = "debug:wireframe";

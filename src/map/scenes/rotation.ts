// Turning around. Rotating the heading spins the world about the user point, which
// sits low on the screen (or below it) in the Himinrond view — so a plain heading
// change feels like the whole map sweeping past. Here the pivot is instead the
// ground point in the middle of the screen: the user point is moved so that point
// stays put while the heading changes. Classic 3D and top-down keep the user
// point as the pivot (it is where you stand, or the screen centre already).

import { bendParamsFromView, groundDistanceAtScreenFraction } from "../engine/bendMath";
import { enuToLonLat, type LonLat } from "../engine/projection";
import { effectiveCameraHeight, type MapState } from "../store/mapStore";

import { CAMERA_FOV_DEG, lookAheadMeters } from "./cameraModel";

type RotationState = Pick<
  MapState,
  | "mode"
  | "userPoint"
  | "heading"
  | "bend"
  | "userPointScreenFraction"
  | "cameraMode"
  | "cameraHeight"
  | "cameraAltitude"
  | "groundHeight"
  | "cameraPitch"
>;

/**
 * Forward distance (metres, unbent) from the user point to the rotation pivot: the ground
 * point at the screen centre in the Himinrond view, 0 (the user point) otherwise.
 */
export function pivotDistance(s: RotationState): number {
  if (s.mode !== "bent" || s.cameraPitch > 1) return 0;
  const h = effectiveCameraHeight(s);
  const composition = {
    userPointScreenFraction: s.userPointScreenFraction,
    fovDeg: CAMERA_FOV_DEG,
  };
  const params = bendParamsFromView(h, s.bend, composition, s.bend.enabled);
  const ahead = lookAheadMeters(h, s.userPointScreenFraction);
  return groundDistanceAtScreenFraction(0.5, params, h, ahead, CAMERA_FOV_DEG);
}

/** New user point that keeps the pivot `distance` metres ahead fixed while turning from `fromHeading` to `toHeading`. */
export function userPointForTurn(
  userPoint: LonLat,
  fromHeading: number,
  toHeading: number,
  distance: number,
): LonLat {
  if (distance <= 0) return userPoint;
  const a = (fromHeading * Math.PI) / 180;
  const b = (toHeading * Math.PI) / 180;
  // pivot = user + d·(sin a, cos a); user' = pivot − d·(sin b, cos b)
  return enuToLonLat(userPoint, {
    east: distance * (Math.sin(a) - Math.sin(b)),
    north: distance * (Math.cos(a) - Math.cos(b)),
  });
}

/** Heading + user point after turning to `toHeading` about the view's natural pivot. */
export function turnTo(
  s: RotationState,
  toHeading: number,
): { heading: number; userPoint: LonLat } {
  const heading = ((toHeading % 360) + 360) % 360;
  return {
    heading,
    userPoint: userPointForTurn(s.userPoint, s.heading, heading, pivotDistance(s)),
  };
}

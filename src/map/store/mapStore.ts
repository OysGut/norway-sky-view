// Central client-side map state for Himinrond (view, camera, time and layers).
import { create } from "zustand";

export type MapMode = "bent" | "classic3d" | "2d";

export interface UserPoint {
  lat: number;
  lon: number;
}

/**
 * Artistic Bent World parameters, expressed as fractions of camera height so the
 * screen composition stays constant while zooming. Metres are derived per frame
 * by engine/bendMath.bendParamsFromView.
 */
export interface BendSettings {
  /** Flat orthographic zone in front of the user (fraction of camera height). */
  flatFraction: number;
  /** Half-width of the transition from flat into compressed (fraction of camera height). */
  transitionFraction: number;
  /** Where the horizon line sits on screen (fraction of viewport height from the bottom); the radius is derived from it. */
  horizonScreenFraction: number;
  /** How far away the horizon line is, in metres of real terrain; the compression is derived from it. */
  horizonDistanceM: number;
  /** Bend profile: 1 = circular, < 1 rises early then eases, > 1 stays flat longer then rises steeply. */
  curveExponent: number;
  /** Height scaling exponent in the compressed zone: 0 = dramatic, 1 = true scale. */
  drama: number;
  /** 0 = terrain behind the user stays flat. */
  backwardWeight: number;
  /** Physical earth curvature (refraction-corrected) in the unbent world. */
  physicalCurvature: boolean;
  /** 1 = Bent World, 0 = classic 3D; animated during mode transitions. */
  enabled: number;
  /** Reserved for the future second bend axis; (1, 0) today. */
  axisWeight: [number, number];
}

export interface MapState {
  userPoint: UserPoint;
  heading: number;
  /** Camera height above the ground at the user point, metres. */
  cameraHeight: number;
  /** Terrain height at the user point, metres above sea level (sampled by the terrain layer). */
  groundHeight: number;
  time: Date;
  followNow: boolean;
  mode: MapMode;
  bend: BendSettings;
  /** Where the user point sits on screen, as a fraction of viewport height from the bottom (negative = below the screen edge). */
  userPointScreenFraction: number;
  layers: Record<string, boolean>;
  setUserPoint: (userPoint: UserPoint) => void;
  setHeading: (heading: number) => void;
  setCameraHeight: (cameraHeight: number) => void;
  setGroundHeight: (groundHeight: number) => void;
  setTime: (time: Date) => void;
  setFollowNow: (followNow: boolean) => void;
  setMode: (mode: MapMode) => void;
  setBend: (bend: Partial<BendSettings>) => void;
  setUserPointScreenFraction: (fraction: number) => void;
  setLayer: (key: string, enabled: boolean) => void;
  setLayers: (layers: Record<string, boolean>) => void;
}

export const useMapStore = create<MapState>((set) => ({
  // Galdhøpiggen
  userPoint: { lat: 61.6364, lon: 8.3125 },
  heading: 0,
  cameraHeight: 1200,
  groundHeight: 0,
  time: new Date(),
  followNow: true,
  mode: "bent",
  bend: {
    flatFraction: 0.25,
    transitionFraction: 0.15,
    horizonScreenFraction: 0.8,
    horizonDistanceM: 150_000,
    curveExponent: 1,
    drama: 0.35,
    backwardWeight: 0,
    physicalCurvature: true,
    enabled: 1,
    axisWeight: [1, 0],
  },
  userPointScreenFraction: 0.3,
  layers: {},
  setUserPoint: (userPoint) => set({ userPoint }),
  setHeading: (heading) => set({ heading }),
  setCameraHeight: (cameraHeight) => set({ cameraHeight }),
  setGroundHeight: (groundHeight) => set({ groundHeight }),
  setTime: (time) => set({ time }),
  setFollowNow: (followNow) => set({ followNow }),
  setMode: (mode) => set({ mode }),
  setBend: (bend) => set((state) => ({ bend: { ...state.bend, ...bend } })),
  setUserPointScreenFraction: (userPointScreenFraction) => set({ userPointScreenFraction }),
  setLayer: (key: string, enabled: boolean) =>
    set((state) => ({ layers: { ...state.layers, [key]: enabled } })),
  setLayers: (layers: Record<string, boolean>) => set({ layers }),
}));

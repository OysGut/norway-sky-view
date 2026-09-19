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
  /** Cylinder radius (fraction of camera height). */
  radiusFraction: number;
  /** Logarithmic compression length L (fraction of camera height); smaller = more compression. */
  compressionFraction: number;
  /** Height scaling exponent in the compressed zone: 0 = dramatic, 1 = true scale. */
  drama: number;
  /** 0 = terrain behind the user stays flat. */
  backwardWeight: number;
  /** 1 = Bent World, 0 = classic 3D; animated during mode transitions. */
  enabled: number;
  /** Reserved for the future second bend axis; (1, 0) today. */
  axisWeight: [number, number];
}

export interface MapState {
  userPoint: UserPoint;
  heading: number;
  cameraHeight: number;
  time: Date;
  followNow: boolean;
  mode: MapMode;
  bend: BendSettings;
  /** Where the user point sits on screen, as a fraction of viewport height from the bottom. */
  userPointScreenFraction: number;
  layers: Record<string, boolean>;
  setUserPoint: (userPoint: UserPoint) => void;
  setHeading: (heading: number) => void;
  setCameraHeight: (cameraHeight: number) => void;
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
  time: new Date(),
  followNow: true,
  mode: "bent",
  bend: {
    flatFraction: 0.25,
    radiusFraction: 0.3,
    compressionFraction: 0.06,
    drama: 0.35,
    backwardWeight: 0,
    enabled: 1,
    axisWeight: [1, 0],
  },
  userPointScreenFraction: 0.3,
  layers: {},
  setUserPoint: (userPoint) => set({ userPoint }),
  setHeading: (heading) => set({ heading }),
  setCameraHeight: (cameraHeight) => set({ cameraHeight }),
  setTime: (time) => set({ time }),
  setFollowNow: (followNow) => set({ followNow }),
  setMode: (mode) => set({ mode }),
  setBend: (bend) => set((state) => ({ bend: { ...state.bend, ...bend } })),
  setUserPointScreenFraction: (userPointScreenFraction) => set({ userPointScreenFraction }),
  setLayer: (key: string, enabled: boolean) =>
    set((state) => ({ layers: { ...state.layers, [key]: enabled } })),
  setLayers: (layers: Record<string, boolean>) => set({ layers }),
}));

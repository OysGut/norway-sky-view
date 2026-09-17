// Central client-side map state for Himinrond (view, camera, time and layers).
import { create } from "zustand";

export type MapMode = "bent" | "classic3d" | "2d";

export interface UserPoint {
  lat: number;
  lon: number;
}

export interface BendSettings {
  radiusKm: number;
  flatZoneKm: number;
  remap: number;
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
  layers: Record<string, boolean>;
  setUserPoint: (userPoint: UserPoint) => void;
  setHeading: (heading: number) => void;
  setCameraHeight: (cameraHeight: number) => void;
  setTime: (time: Date) => void;
  setFollowNow: (followNow: boolean) => void;
  setMode: (mode: MapMode) => void;
  setBend: (bend: Partial<BendSettings>) => void;
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
  bend: { radiusKm: 6, flatZoneKm: 2, remap: 0.5, axisWeight: [1, 0] },
  layers: {},
  setUserPoint: (userPoint) => set({ userPoint }),
  setHeading: (heading) => set({ heading }),
  setCameraHeight: (cameraHeight) => set({ cameraHeight }),
  setTime: (time) => set({ time }),
  setFollowNow: (followNow) => set({ followNow }),
  setMode: (mode) => set({ mode }),
  setBend: (bend) => set((state) => ({ bend: { ...state.bend, ...bend } })),
  setLayer: (key: string, enabled: boolean) => set((state) => ({ layers: { ...state.layers, [key]: enabled } })),
  setLayers: (layers: Record<string, boolean>) => set({ layers }),
}));

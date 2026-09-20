// Central client-side map state for Himinrond (view, camera, time and layers).
//
// View modes: "bent" (Bent World), "classic3d" (tilted perspective, no bend) and
// "2d" (straight down, no bend). Each mode remembers its own view settings, and
// any set of settings can be saved as a named preset. Modes, per-mode settings
// and presets are persisted in localStorage; position and time are not.
//
// Persistence is skipped during SSR and hydration — call hydrateMapStore() from a
// client effect (see store/hydrate.ts) so the first client render matches the server.

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type MapMode = "bent" | "classic3d" | "2d";
export const MAP_MODES: readonly MapMode[] = ["bent", "classic3d", "2d"];

/**
 * How the camera height is controlled:
 *  - "terrain": a fixed distance above the ground under the user (follows the terrain)
 *  - "absolute": a fixed altitude above sea level, whatever the terrain does
 */
export type CameraMode = "terrain" | "absolute";

export const CAMERA_HEIGHT_MIN = 200;
export const CAMERA_HEIGHT_MAX = 20_000;
export const CAMERA_ALTITUDE_MIN = 200;
export const CAMERA_ALTITUDE_MAX = 20_000;
/** Camera tilt from straight down, degrees. 0 = top-down, 80 = almost horizontal. */
export const CAMERA_PITCH_MIN = 0;
export const CAMERA_PITCH_MAX = 80;

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
  /** 1 = Bent World, 0 = classic 3D; the scene eases toward it during mode transitions. */
  enabled: number;
  /** Reserved for the future second bend axis; (1, 0) today. */
  axisWeight: [number, number];
}

/** Everything that makes up "how the map looks" — remembered per mode and saved in presets. */
export interface ViewSettings {
  bend: BendSettings;
  /** Where the user point sits on screen, as a fraction of viewport height from the bottom (negative = below the screen edge). */
  userPointScreenFraction: number;
  cameraMode: CameraMode;
  /** Camera height above the ground at the user point, metres (used in "terrain" mode). */
  cameraHeight: number;
  /** Camera altitude above sea level, metres (used in "absolute" mode). */
  cameraAltitude: number;
  /** Camera tilt from straight down, degrees. */
  cameraPitch: number;
}

export interface ViewPreset {
  id: string;
  name: string;
  mode: MapMode;
  settings: ViewSettings;
  /** ISO timestamp */
  createdAt: string;
}

export interface MapState extends ViewSettings {
  userPoint: UserPoint;
  heading: number;
  /** Terrain height at the user point, metres above sea level (sampled by the terrain layer). */
  groundHeight: number;
  time: Date;
  followNow: boolean;
  mode: MapMode;
  /** The last settings used in each mode; restored when switching back. */
  viewSettingsByMode: Record<MapMode, ViewSettings>;
  presets: ViewPreset[];
  layers: Record<string, boolean>;
  setUserPoint: (userPoint: UserPoint) => void;
  setHeading: (heading: number) => void;
  setCameraHeight: (cameraHeight: number) => void;
  setCameraAltitude: (cameraAltitude: number) => void;
  setCameraMode: (cameraMode: CameraMode) => void;
  setCameraPitch: (cameraPitch: number) => void;
  setGroundHeight: (groundHeight: number) => void;
  setTime: (time: Date) => void;
  setFollowNow: (followNow: boolean) => void;
  /** Switch view mode: remembers the current settings for the old mode and restores the new mode's. */
  setMode: (mode: MapMode) => void;
  setBend: (bend: Partial<BendSettings>) => void;
  setUserPointScreenFraction: (fraction: number) => void;
  /** Back to the built-in defaults for the current mode. */
  resetViewSettings: () => void;
  /** Save the current mode + settings under a name (replaces a preset with the same name). */
  savePreset: (name: string) => ViewPreset | null;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => void;
  setLayer: (key: string, enabled: boolean) => void;
  setLayers: (layers: Record<string, boolean>) => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const DEFAULT_BEND: BendSettings = {
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
};

/** Built-in view settings per mode. */
export const DEFAULT_VIEW_SETTINGS: Record<MapMode, ViewSettings> = {
  bent: {
    bend: { ...DEFAULT_BEND, axisWeight: [1, 0] },
    userPointScreenFraction: 0.3,
    cameraMode: "terrain",
    cameraHeight: 1200,
    cameraAltitude: 3500,
    cameraPitch: 0,
  },
  classic3d: {
    bend: { ...DEFAULT_BEND, axisWeight: [1, 0], enabled: 0 },
    userPointScreenFraction: 0.2,
    cameraMode: "terrain",
    cameraHeight: 1200,
    cameraAltitude: 3500,
    // horizon ≈ 0.85 of the screen height with the user point at 0.2 (fov 50°)
    cameraPitch: 72,
  },
  "2d": {
    bend: { ...DEFAULT_BEND, axisWeight: [1, 0], enabled: 0 },
    userPointScreenFraction: 0.5,
    cameraMode: "terrain",
    cameraHeight: 3000,
    cameraAltitude: 5000,
    cameraPitch: 0,
  },
};

function cloneViewSettings(v: ViewSettings): ViewSettings {
  return { ...v, bend: { ...v.bend, axisWeight: [v.bend.axisWeight[0], v.bend.axisWeight[1]] } };
}

/** The active view settings, picked out of the full state. */
export function currentViewSettings(s: ViewSettings): ViewSettings {
  return cloneViewSettings({
    bend: s.bend,
    userPointScreenFraction: s.userPointScreenFraction,
    cameraMode: s.cameraMode,
    cameraHeight: s.cameraHeight,
    cameraAltitude: s.cameraAltitude,
    cameraPitch: s.cameraPitch,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function isMapMode(v: unknown): v is MapMode {
  return v === "bent" || v === "classic3d" || v === "2d";
}

/** Coerce anything read from storage into valid view settings (never trust old data). */
export function sanitizeViewSettings(raw: unknown, fallback: ViewSettings): ViewSettings {
  if (!isRecord(raw)) return cloneViewSettings(fallback);
  const b = isRecord(raw["bend"]) ? raw["bend"] : {};
  const fb = fallback.bend;
  return {
    bend: {
      flatFraction: num(b["flatFraction"], fb.flatFraction, 0, 2),
      transitionFraction: num(b["transitionFraction"], fb.transitionFraction, 0, 2),
      horizonScreenFraction: num(b["horizonScreenFraction"], fb.horizonScreenFraction, 0.1, 1),
      horizonDistanceM: num(b["horizonDistanceM"], fb.horizonDistanceM, 1_000, 1_000_000),
      curveExponent: num(b["curveExponent"], fb.curveExponent, 0.1, 5),
      drama: num(b["drama"], fb.drama, 0, 1),
      backwardWeight: num(b["backwardWeight"], fb.backwardWeight, 0, 1),
      physicalCurvature:
        typeof b["physicalCurvature"] === "boolean" ? b["physicalCurvature"] : fb.physicalCurvature,
      enabled: num(b["enabled"], fb.enabled, 0, 1),
      axisWeight: [1, 0],
    },
    userPointScreenFraction: num(
      raw["userPointScreenFraction"],
      fallback.userPointScreenFraction,
      -1,
      1,
    ),
    cameraMode: raw["cameraMode"] === "absolute" ? "absolute" : "terrain",
    cameraHeight: num(
      raw["cameraHeight"],
      fallback.cameraHeight,
      CAMERA_HEIGHT_MIN,
      CAMERA_HEIGHT_MAX,
    ),
    cameraAltitude: num(
      raw["cameraAltitude"],
      fallback.cameraAltitude,
      CAMERA_ALTITUDE_MIN,
      CAMERA_ALTITUDE_MAX,
    ),
    cameraPitch: num(raw["cameraPitch"], fallback.cameraPitch, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX),
  };
}

function sanitizePreset(raw: unknown): ViewPreset | null {
  if (!isRecord(raw)) return null;
  const mode = isMapMode(raw["mode"]) ? raw["mode"] : "bent";
  const name = typeof raw["name"] === "string" ? raw["name"].trim().slice(0, 60) : "";
  const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : "";
  if (!name || !id) return null;
  return {
    id,
    name,
    mode,
    settings: sanitizeViewSettings(raw["settings"], DEFAULT_VIEW_SETTINGS[mode]),
    createdAt: typeof raw["createdAt"] === "string" ? raw["createdAt"] : new Date(0).toISOString(),
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Camera height above the ground under the user for the current mode. In absolute
 * mode the camera never goes below CAMERA_HEIGHT_MIN over the terrain.
 */
export function effectiveCameraHeight(
  s: Pick<MapState, "cameraMode" | "cameraHeight" | "cameraAltitude" | "groundHeight">,
): number {
  if (s.cameraMode === "absolute") {
    return clamp(s.cameraAltitude - s.groundHeight, CAMERA_HEIGHT_MIN, CAMERA_HEIGHT_MAX);
  }
  return s.cameraHeight;
}

/** The slice of the state that survives a reload. */
interface PersistedMapState {
  mode: MapMode;
  view: ViewSettings;
  viewSettingsByMode: Record<MapMode, ViewSettings>;
  presets: ViewPreset[];
}

export const MAP_STORE_STORAGE_KEY = "himinrond_map";
const MAP_STORE_VERSION = 1;

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function defaultViewSettingsByMode(): Record<MapMode, ViewSettings> {
  return {
    bent: cloneViewSettings(DEFAULT_VIEW_SETTINGS.bent),
    classic3d: cloneViewSettings(DEFAULT_VIEW_SETTINGS.classic3d),
    "2d": cloneViewSettings(DEFAULT_VIEW_SETTINGS["2d"]),
  };
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      // Galdhøpiggen
      userPoint: { lat: 61.6364, lon: 8.3125 },
      heading: 0,
      groundHeight: 0,
      time: new Date(),
      followNow: true,
      mode: "bent",
      ...cloneViewSettings(DEFAULT_VIEW_SETTINGS.bent),
      viewSettingsByMode: defaultViewSettingsByMode(),
      presets: [],
      layers: {},
      setUserPoint: (userPoint) => set({ userPoint }),
      setHeading: (heading) => set({ heading }),
      setCameraHeight: (cameraHeight) =>
        set({ cameraHeight: clamp(cameraHeight, CAMERA_HEIGHT_MIN, CAMERA_HEIGHT_MAX) }),
      setCameraAltitude: (cameraAltitude) =>
        set({ cameraAltitude: clamp(cameraAltitude, CAMERA_ALTITUDE_MIN, CAMERA_ALTITUDE_MAX) }),
      setCameraMode: (cameraMode) => set({ cameraMode }),
      setCameraPitch: (cameraPitch) =>
        set({ cameraPitch: clamp(cameraPitch, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX) }),
      setGroundHeight: (groundHeight) => set({ groundHeight }),
      setTime: (time) => set({ time }),
      setFollowNow: (followNow) => set({ followNow }),
      setMode: (mode) =>
        set((state) => {
          if (mode === state.mode) return {};
          const remembered = {
            ...state.viewSettingsByMode,
            [state.mode]: currentViewSettings(state),
          };
          return { mode, viewSettingsByMode: remembered, ...cloneViewSettings(remembered[mode]) };
        }),
      setBend: (bend) => set((state) => ({ bend: { ...state.bend, ...bend } })),
      setUserPointScreenFraction: (userPointScreenFraction) => set({ userPointScreenFraction }),
      resetViewSettings: () => set((state) => cloneViewSettings(DEFAULT_VIEW_SETTINGS[state.mode])),
      savePreset: (rawName) => {
        const name = rawName.trim().slice(0, 60);
        if (!name) return null;
        const state = get();
        const existing = state.presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
        const preset: ViewPreset = {
          id: existing?.id ?? newId(),
          name,
          mode: state.mode,
          settings: currentViewSettings(state),
          createdAt: new Date().toISOString(),
        };
        set({
          presets: existing
            ? state.presets.map((p) => (p.id === preset.id ? preset : p))
            : [...state.presets, preset],
        });
        return preset;
      },
      applyPreset: (id) =>
        set((state) => {
          const preset = state.presets.find((p) => p.id === id);
          if (!preset) return {};
          const remembered =
            preset.mode === state.mode
              ? state.viewSettingsByMode
              : { ...state.viewSettingsByMode, [state.mode]: currentViewSettings(state) };
          return {
            mode: preset.mode,
            viewSettingsByMode: remembered,
            ...cloneViewSettings(preset.settings),
          };
        }),
      deletePreset: (id) => set((state) => ({ presets: state.presets.filter((p) => p.id !== id) })),
      setLayer: (key: string, enabled: boolean) =>
        set((state) => ({ layers: { ...state.layers, [key]: enabled } })),
      setLayers: (layers: Record<string, boolean>) => set({ layers }),
    }),
    {
      name: MAP_STORE_STORAGE_KEY,
      version: MAP_STORE_VERSION,
      // No storage on the server; the client rehydrates explicitly (hydrateMapStore).
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.localStorage,
      ),
      skipHydration: true,
      partialize: (state): PersistedMapState => ({
        mode: state.mode,
        view: currentViewSettings(state),
        viewSettingsByMode: state.viewSettingsByMode,
        presets: state.presets,
      }),
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current;
        const mode = isMapMode(persisted["mode"]) ? persisted["mode"] : current.mode;
        const storedByMode = isRecord(persisted["viewSettingsByMode"])
          ? persisted["viewSettingsByMode"]
          : {};
        const viewSettingsByMode = defaultViewSettingsByMode();
        for (const m of MAP_MODES) {
          viewSettingsByMode[m] = sanitizeViewSettings(storedByMode[m], DEFAULT_VIEW_SETTINGS[m]);
        }
        const view = sanitizeViewSettings(persisted["view"], viewSettingsByMode[mode]);
        const presets = Array.isArray(persisted["presets"])
          ? persisted["presets"].map(sanitizePreset).filter((p): p is ViewPreset => p !== null)
          : [];
        return { ...current, mode, viewSettingsByMode, presets, ...view };
      },
    },
  ),
);

/** Load the persisted view (mode, settings, presets) from localStorage. Client only. */
export function hydrateMapStore(): Promise<void> | void {
  if (typeof window === "undefined") return;
  return useMapStore.persist.rehydrate();
}

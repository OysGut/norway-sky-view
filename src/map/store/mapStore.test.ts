import { beforeEach, describe, expect, it } from "vitest";

import {
  CAMERA_HEIGHT_MAX,
  DEFAULT_VIEW_SETTINGS,
  MAP_STORE_STORAGE_KEY,
  currentViewSettings,
  sanitizeViewSettings,
  useMapStore,
} from "./mapStore";

const initial = useMapStore.getInitialState();

beforeEach(() => {
  useMapStore.setState(
    {
      ...initial,
      viewSettingsByMode: {
        bent: { ...DEFAULT_VIEW_SETTINGS.bent },
        classic3d: { ...DEFAULT_VIEW_SETTINGS.classic3d },
        "2d": { ...DEFAULT_VIEW_SETTINGS["2d"] },
      },
      presets: [],
    },
    true,
  );
});

describe("view modes", () => {
  it("starts in Bent World with the bent defaults", () => {
    const s = useMapStore.getState();
    expect(s.mode).toBe("bent");
    expect(s.cameraPitch).toBe(0);
    expect(s.bend.enabled).toBe(1);
  });

  it("loads the new mode's settings and remembers the old mode's", () => {
    const s = useMapStore.getState();
    s.setCameraHeight(4200);
    s.setBend({ drama: 0.9 });
    s.setMode("classic3d");
    let n = useMapStore.getState();
    expect(n.mode).toBe("classic3d");
    expect(n.cameraPitch).toBe(DEFAULT_VIEW_SETTINGS.classic3d.cameraPitch);
    expect(n.bend.enabled).toBe(0);
    expect(n.viewSettingsByMode.bent.cameraHeight).toBe(4200);
    expect(n.viewSettingsByMode.bent.bend.drama).toBe(0.9);

    n.setCameraPitch(45);
    n.setMode("bent");
    n = useMapStore.getState();
    expect(n.cameraHeight).toBe(4200);
    expect(n.bend.drama).toBe(0.9);
    expect(n.cameraPitch).toBe(0);
    expect(n.viewSettingsByMode.classic3d.cameraPitch).toBe(45);
  });

  it("switching to the same mode is a no-op", () => {
    const before = useMapStore.getState();
    before.setMode("bent");
    expect(useMapStore.getState().viewSettingsByMode).toBe(before.viewSettingsByMode);
  });

  it("resets the current mode to its defaults", () => {
    const s = useMapStore.getState();
    s.setMode("2d");
    s.setCameraHeight(9000);
    useMapStore.getState().resetViewSettings();
    expect(useMapStore.getState().cameraHeight).toBe(DEFAULT_VIEW_SETTINGS["2d"].cameraHeight);
    expect(useMapStore.getState().mode).toBe("2d");
  });

  it("clamps the pitch", () => {
    useMapStore.getState().setCameraPitch(200);
    expect(useMapStore.getState().cameraPitch).toBe(80);
    useMapStore.getState().setCameraPitch(-5);
    expect(useMapStore.getState().cameraPitch).toBe(0);
  });
});

describe("presets", () => {
  it("saves, applies and deletes named presets", () => {
    const s = useMapStore.getState();
    s.setMode("classic3d");
    useMapStore.getState().setCameraPitch(30);
    const preset = useMapStore.getState().savePreset("  Lav sol  ");
    expect(preset?.name).toBe("Lav sol");
    expect(preset?.mode).toBe("classic3d");
    expect(preset?.settings.cameraPitch).toBe(30);

    useMapStore.getState().setMode("bent");
    useMapStore.getState().setCameraHeight(777);
    useMapStore.getState().applyPreset(preset!.id);
    const after = useMapStore.getState();
    expect(after.mode).toBe("classic3d");
    expect(after.cameraPitch).toBe(30);
    // the bent settings were remembered on the way out
    expect(after.viewSettingsByMode.bent.cameraHeight).toBe(777);

    after.deletePreset(preset!.id);
    expect(useMapStore.getState().presets).toHaveLength(0);
  });

  it("replaces a preset with the same name (case-insensitive) and keeps its id", () => {
    const first = useMapStore.getState().savePreset("Kveld");
    useMapStore.getState().setCameraHeight(5000);
    const second = useMapStore.getState().savePreset("kveld");
    expect(second?.id).toBe(first?.id);
    expect(useMapStore.getState().presets).toHaveLength(1);
    expect(useMapStore.getState().presets[0]?.settings.cameraHeight).toBe(5000);
  });

  it("ignores empty names", () => {
    expect(useMapStore.getState().savePreset("   ")).toBeNull();
    expect(useMapStore.getState().presets).toHaveLength(0);
  });

  it("preset settings are a snapshot, not a live reference", () => {
    const preset = useMapStore.getState().savePreset("Snap")!;
    useMapStore.getState().setBend({ drama: 0.01 });
    expect(preset.settings.bend.drama).toBe(DEFAULT_VIEW_SETTINGS.bent.bend.drama);
  });
});

describe("sanitizeViewSettings", () => {
  it("falls back to defaults for garbage and clamps numbers", () => {
    const fb = DEFAULT_VIEW_SETTINGS.bent;
    expect(sanitizeViewSettings(null, fb)).toEqual(fb);
    const v = sanitizeViewSettings(
      {
        bend: { drama: 7, horizonDistanceM: "far", physicalCurvature: false },
        cameraHeight: 1e9,
        cameraMode: "nonsense",
        cameraPitch: -30,
      },
      fb,
    );
    expect(v.bend.drama).toBe(1);
    expect(v.bend.horizonDistanceM).toBe(fb.bend.horizonDistanceM);
    expect(v.bend.physicalCurvature).toBe(false);
    expect(v.cameraHeight).toBe(CAMERA_HEIGHT_MAX);
    expect(v.cameraMode).toBe("terrain");
    expect(v.cameraPitch).toBe(0);
  });

  it("currentViewSettings picks exactly the view fields", () => {
    const view = currentViewSettings(useMapStore.getState());
    expect(Object.keys(view).sort()).toEqual(
      [
        "bend",
        "cameraAltitude",
        "cameraHeight",
        "cameraMode",
        "cameraPitch",
        "userPointScreenFraction",
      ].sort(),
    );
  });
});

describe("persistence", () => {
  it("uses a stable storage key and skips automatic hydration", () => {
    expect(MAP_STORE_STORAGE_KEY).toBe("himinrond_map");
    expect(useMapStore.persist.getOptions().skipHydration).toBe(true);
  });
});

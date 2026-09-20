// Client-only three.js canvas for the Bent World view. Loaded lazily by
// BentWorldScene so nothing here ever runs on the server.
//
// Camera model (Knowledge → Architecture decisions): the camera is FIXED over
// the origin; the world root rotates by heading and is translated so that
// mapStore.userPoint sits at the origin. In the Bent World the camera looks
// straight down with its target pushed forward so the user point sits in the
// lower part of the screen and the bent horizon has room at the top; in classic
// 3D it tilts toward the horizon (cameraPitch) with the bend eased off. Mode
// switches ease pitch, composition and bend strength so the map "straightens
// out" instead of jumping. Scene axes: x = east, y = up, z = -north.
//
// Phase 1: real terrain (TerrainLayer: nested tile rings meshed from Terrarium
// heights in workers, Kartverket topo textures, lit), bent by the shared chunk,
// with physical earth curvature applied in the shader.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useReducedMotion } from "@/lib/motion";
import { bendParamsFromView } from "@/map/engine/bendMath";
import { lonLatToEnu, type LonLat } from "@/map/engine/projection";
import {
  createBendUniforms,
  updateBendUniforms,
  type BendUniforms,
} from "@/map/engine/shaders/bend.glsl";
import { TerrainLayer } from "@/map/layers/TerrainLayer";
import { CAMERA_ALTITUDE_MAX, effectiveCameraHeight, useMapStore } from "@/map/store/mapStore";

import { CAMERA_FOV_DEG, cameraPose } from "./cameraModel";
import { sampleFlight } from "./flight";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import { usePointerNavigation } from "./usePointerNavigation";

const BACKGROUND = "#0A0E17";
const ACCENT = "#3FE8B0";
const EASE_RATE = 8; // 1 - exp(-dt * EASE_RATE)
/** The ENU origin is moved to the user point once they are this far from it (keeps the local projection honest). */
const REBASE_DISTANCE_M = 50_000;
/** Terrain rings reach ≈ 370 km; give the far plane room for the horizon and the bent sky band. */
const CAMERA_FAR_M = 1_500_000;
/** Slower easing for view-mode transitions (pitch, composition, bend strength). */
const MODE_EASE_RATE = 3;
/** Heading and position ease together, quickly, so drags and turns feel direct but smooth. */
const POSE_EASE_RATE = 14;
/** Sun for the placeholder lighting until phase 2 drives it from suncalc. */
const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.7, 0.45).normalize();

interface ViewState {
  /** eased camera height above the ground, metres */
  height: number;
  /** eased heading, degrees */
  heading: number;
  /** eased terrain height under the user, metres a.s.l. */
  ground: number;
  /** eased camera tilt from straight down, degrees */
  pitch: number;
  /** eased user point screen fraction */
  composition: number;
  /** eased bend strength 0..1 */
  bendEnabled: number;
  /** eased user point (degrees); heading and position ease at the same rate so turning about a pivot stays put */
  lat: number;
  lon: number;
}

function ease(
  current: number,
  target: number,
  dt: number,
  snap: boolean,
  rate: number = EASE_RATE,
): number {
  if (snap) return target;
  const k = 1 - Math.exp(-dt * rate);
  return current + (target - current) * k;
}

function easeAngleDeg(
  current: number,
  target: number,
  dt: number,
  snap: boolean,
  rate: number = EASE_RATE,
): number {
  let delta = ((target - current + 540) % 360) - 180;
  if (snap) delta = target - current;
  const k = snap ? 1 : 1 - Math.exp(-dt * rate);
  return (((current + delta * k) % 360) + 360) % 360;
}

/** Fixed camera above the origin; height, pitch and composition ease toward the store. */
function CameraRig({
  view,
  reducedMotion,
}: {
  view: React.RefObject<ViewState>;
  reducedMotion: boolean;
}) {
  const camera = useThree((s) => s.camera);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const state = useMapStore.getState();
    view.current.height = ease(
      view.current.height,
      effectiveCameraHeight(state),
      dt,
      reducedMotion,
    );
    view.current.pitch = ease(
      view.current.pitch,
      state.cameraPitch,
      dt,
      reducedMotion,
      MODE_EASE_RATE,
    );
    view.current.composition = ease(
      view.current.composition,
      state.userPointScreenFraction,
      dt,
      reducedMotion,
      MODE_EASE_RATE,
    );
    view.current.bendEnabled = ease(
      view.current.bendEnabled,
      state.bend.enabled,
      dt,
      reducedMotion,
      MODE_EASE_RATE,
    );
    const pose = cameraPose(view.current.height, view.current.pitch, view.current.composition);
    camera.position.set(...pose.position);
    camera.up.set(...pose.up);
    camera.lookAt(...pose.target);
  });

  return null;
}

/** Owns the shared bend uniforms and refreshes them from the store every frame. */
function useBendUniforms(view: React.RefObject<ViewState>): BendUniforms {
  const uniforms = useMemo(() => {
    const s = useMapStore.getState();
    const composition = {
      userPointScreenFraction: s.userPointScreenFraction,
      fovDeg: CAMERA_FOV_DEG,
    };
    return createBendUniforms(
      bendParamsFromView(effectiveCameraHeight(s), s.bend, composition, s.bend.enabled),
    );
  }, []);

  useFrame(() => {
    const s = useMapStore.getState();
    const composition = {
      userPointScreenFraction: view.current.composition,
      fovDeg: CAMERA_FOV_DEG,
    };
    updateBendUniforms(
      uniforms,
      bendParamsFromView(view.current.height, s.bend, composition, view.current.bendEnabled),
    );
  });

  return uniforms;
}

/** Thin accent cross at the user point. Not bent: it sits at the origin. */
function OriginCross({ size = 200 }: { size?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const h = size / 2;
    const y = 3; // just above the ground at the user point
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-h, y, 0, h, y, 0, 0, y, -h, 0, y, h], 3),
    );
    return g;
  }, [size]);
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: ACCENT }), []);
  return <lineSegments geometry={geometry} material={material} />;
}

/** Rotates by heading and translates so the user point is at the origin. */
function WorldRoot({
  origin,
  view,
  reducedMotion,
  children,
}: {
  origin: React.RefObject<LonLat>;
  view: React.RefObject<ViewState>;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const rotation = useRef<THREE.Group>(null);
  const translation = useRef<THREE.Group>(null);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const state = useMapStore.getState();
    view.current.heading = easeAngleDeg(
      view.current.heading,
      state.heading,
      dt,
      reducedMotion,
      POSE_EASE_RATE,
    );
    view.current.lat = ease(
      view.current.lat,
      state.userPoint.lat,
      dt,
      reducedMotion,
      POSE_EASE_RATE,
    );
    view.current.lon = ease(
      view.current.lon,
      state.userPoint.lon,
      dt,
      reducedMotion,
      POSE_EASE_RATE,
    );
    view.current.ground = ease(view.current.ground, state.groundHeight, dt, reducedMotion);
    if (rotation.current) rotation.current.rotation.y = (view.current.heading * Math.PI) / 180;
    if (translation.current) {
      // the ground under the user becomes y = 0: the bend cylinder and the camera are anchored there
      const offset = lonLatToEnu(origin.current, { lat: view.current.lat, lon: view.current.lon });
      translation.current.position.set(-offset.east, -view.current.ground, offset.north);
    }
  });

  return (
    <group ref={rotation} name="worldRoot">
      <group ref={translation}>{children}</group>
    </group>
  );
}

/** Keyboard, pointer and fly-to navigation, plus re-basing of the ENU origin after long moves. */
function NavigationDriver({
  target,
  origin,
}: {
  target: React.RefObject<HTMLDivElement | null>;
  origin: React.RefObject<LonLat>;
}) {
  const camera = useThree((s) => s.camera);
  const keys = useKeyboardNavigation(target);
  const pointer = usePointerNavigation(target, camera);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const state = useMapStore.getState();
    if (state.flight) {
      const sample = sampleFlight(state.flight, performance.now());
      state.setUserPoint(sample.point);
      state.setHeading(sample.heading);
      state.setCameraHeight(sample.height);
      state.setCameraAltitude(Math.min(CAMERA_ALTITUDE_MAX, sample.height + state.groundHeight));
      if (sample.done) state.cancelFlight();
    }
    // manual navigation runs every frame and cancels a flight when used
    keys.step(dt);
    pointer.step(dt);
    const after = useMapStore.getState();
    if (!after.flight) {
      // far from the origin and not flying: make the user point the new origin (the terrain
      // layer notices the change and rebuilds around it)
      const d = lonLatToEnu(origin.current, after.userPoint);
      if (Math.hypot(d.east, d.north) > REBASE_DISTANCE_M) {
        origin.current = { ...after.userPoint };
      }
    }
  });
  return null;
}

function BentWorld({
  origin,
  view,
  reducedMotion,
}: {
  origin: React.RefObject<LonLat>;
  view: React.RefObject<ViewState>;
  reducedMotion: boolean;
}) {
  const uniforms = useBendUniforms(view);
  return (
    <>
      <hemisphereLight args={["#cfe3ff", "#3b3a33", 0.55]} />
      <directionalLight
        position={[SUN_DIRECTION.x * 10_000, SUN_DIRECTION.y * 10_000, SUN_DIRECTION.z * 10_000]}
        intensity={2.2}
        color="#fff4e0"
      />
      <WorldRoot origin={origin} view={view} reducedMotion={reducedMotion}>
        <TerrainLayer origin={origin} uniforms={uniforms} />
      </WorldRoot>
    </>
  );
}

export default function BentWorldCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // The ENU origin starts at the user point; navigation moves the world root, and the origin
  // is re-based onto the user point after long moves (NavigationDriver).
  const origin = useRef<LonLat>({ ...useMapStore.getState().userPoint });
  const initial = useMapStore.getState();
  const view = useRef<ViewState>({
    height: effectiveCameraHeight(initial),
    heading: initial.heading,
    ground: initial.groundHeight,
    lat: initial.userPoint.lat,
    lon: initial.userPoint.lon,
    pitch: initial.cameraPitch,
    composition: initial.userPointScreenFraction,
    bendEnabled: initial.bend.enabled,
  });
  const initialPose = cameraPose(
    effectiveCameraHeight(initial),
    initial.cameraPitch,
    initial.userPointScreenFraction,
  );

  return (
    <div
      ref={container}
      className="h-full w-full touch-none select-none"
      tabIndex={0}
      aria-label="Himinrond"
    >
      <Canvas
        dpr={[1, 2]}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
          logarithmicDepthBuffer: true,
        }}
        camera={{
          fov: CAMERA_FOV_DEG,
          near: 1,
          far: CAMERA_FAR_M,
          position: initialPose.position,
          up: initialPose.up,
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <CameraRig view={view} reducedMotion={reducedMotion} />
        <NavigationDriver target={container} origin={origin} />
        <BentWorld origin={origin} view={view} reducedMotion={reducedMotion} />
        <OriginCross />
      </Canvas>
    </div>
  );
}

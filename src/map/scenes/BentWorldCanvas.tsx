// Client-only three.js canvas for the Bent World view. Loaded lazily by
// BentWorldScene so nothing here ever runs on the server.
//
// Camera model (Knowledge → Architecture decisions): the camera is FIXED,
// looking straight down; the world root rotates by heading and is translated so
// that mapStore.userPoint sits at the origin. The camera target is pushed a
// little forward so the user point sits in the lower part of the screen and the
// bent horizon has room at the top. Scene axes: x = east, y = up, z = -north.
//
// Phase 0.8: flat Kartverket tiles (a dense near ring + a coarse far ring) bent by
// the shared bend chunk. No elevation yet.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { useReducedMotion } from "@/lib/motion";
import { bendParamsFromView } from "@/map/engine/bendMath";
import {
  lonLatToEnu,
  lonLatToTile,
  tileToLonLatBounds,
  type LonLat,
  type TileKey,
} from "@/map/engine/projection";
import {
  createBendUniforms,
  updateBendUniforms,
  type BendUniforms,
} from "@/map/engine/shaders/bend.glsl";
import { applyBendToMaterial } from "@/map/engine/shaders/bendMaterial";
import { useMapStore } from "@/map/store/mapStore";

import { CAMERA_FOV_DEG, WIREFRAME_LAYER, lookAheadMeters } from "./cameraModel";
import { useKeyboardNavigation } from "./useKeyboardNavigation";

const BACKGROUND = "#0A0E17";
const ACCENT = "#3FE8B0";
const PLACEHOLDER = "#151A26"; // card tone while a tile loads
const EASE_RATE = 8; // 1 - exp(-dt * EASE_RATE)

/** Near ring: dense meshes so the knee of the bend stays smooth. */
const NEAR_ZOOM = 12;
const NEAR_RING = 1; // 3 × 3 tiles ≈ 14 km
const NEAR_SEGMENTS = 128;
/** Far ring: coarse meshes reaching the compressed horizon. */
const FAR_ZOOM = 9;
const FAR_RING = 2; // 5 × 5 tiles ≈ 370 km
const FAR_SEGMENTS = 96;
/** Lift the near ring a hair above the far ring to avoid z-fighting where they overlap. */
const NEAR_LIFT_M = 1.5;

interface ViewState {
  /** eased camera height, metres */
  height: number;
  /** eased heading, degrees */
  heading: number;
}

function kartverketTileUrl(layer: string, z: number, x: number, y: number): string {
  return `https://cache.kartverket.no/v1/wmts/1.0.0/${layer}/default/webmercator/${z}/${y}/${x}.png`;
}

function ease(current: number, target: number, dt: number, snap: boolean): number {
  if (snap) return target;
  const k = 1 - Math.exp(-dt * EASE_RATE);
  return current + (target - current) * k;
}

function easeAngleDeg(current: number, target: number, dt: number, snap: boolean): number {
  let delta = ((target - current + 540) % 360) - 180;
  if (snap) delta = target - current;
  const k = snap ? 1 : 1 - Math.exp(-dt * EASE_RATE);
  return (((current + delta * k) % 360) + 360) % 360;
}

/** Fixed camera above the origin; height eases toward the store, target is pushed forward. */
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
    view.current.height = ease(view.current.height, state.cameraHeight, dt, reducedMotion);
    const ahead = lookAheadMeters(view.current.height, state.userPointScreenFraction);
    camera.position.set(0, view.current.height, -ahead);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, -ahead);
  });

  return null;
}

/** Owns the shared bend uniforms and refreshes them from the store every frame. */
function useBendUniforms(view: React.RefObject<ViewState>): BendUniforms {
  const uniforms = useMemo(() => {
    const s = useMapStore.getState();
    return createBendUniforms(bendParamsFromView(s.cameraHeight, s.bend, s.bend.enabled));
  }, []);

  useFrame(() => {
    const s = useMapStore.getState();
    updateBendUniforms(uniforms, bendParamsFromView(view.current.height, s.bend, s.bend.enabled));
  });

  return uniforms;
}

/**
 * Load a texture without Suspense: a failed tile must never unmount the scene.
 * Returns null until loaded (or on failure, after logging a warning).
 */
function useTextureSafe(url: string): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (loaded) => {
        if (cancelled) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = gl.capabilities.getMaxAnisotropy();
        loaded.minFilter = THREE.LinearMipmapLinearFilter;
        loaded.needsUpdate = true;
        setTexture(loaded);
      },
      undefined,
      () => {
        if (!cancelled) console.warn(`[BentWorld] texture failed to load: ${url}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url, gl]);

  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}

/** A bent MeshBasicMaterial (textured or placeholder) sharing the scene's bend uniforms. */
function useBentBasicMaterial(
  texture: THREE.Texture | null,
  uniforms: BendUniforms,
): THREE.MeshBasicMaterial {
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color: PLACEHOLDER, toneMapped: false });
    return applyBendToMaterial(m, uniforms);
  }, [uniforms]);

  useEffect(() => {
    material.map = texture;
    material.color.set(texture ? "#ffffff" : PLACEHOLDER);
    material.needsUpdate = true;
  }, [material, texture]);

  useEffect(() => () => material.dispose(), [material]);

  // Debug wireframe (spike tuning): toggled through mapStore.layers.
  useFrame(() => {
    const wire = useMapStore.getState().layers[WIREFRAME_LAYER] === true;
    if (material.wireframe !== wire) {
      material.wireframe = wire;
      material.needsUpdate = true;
    }
  });

  return material;
}

/** One Kartverket topo tile as a flat, subdivided plane placed in ENU metres around `origin`. */
function TilePlane({
  origin,
  tile,
  segments,
  lift,
  uniforms,
}: {
  origin: LonLat;
  tile: TileKey;
  segments: number;
  lift: number;
  uniforms: BendUniforms;
}) {
  const texture = useTextureSafe(kartverketTileUrl("topo", tile.z, tile.x, tile.y));
  const material = useBentBasicMaterial(texture, uniforms);

  const placement = useMemo(() => {
    const b = tileToLonLatBounds(tile.x, tile.y, tile.z);
    const sw = lonLatToEnu(origin, { lon: b.west, lat: b.south });
    const ne = lonLatToEnu(origin, { lon: b.east, lat: b.north });
    return {
      width: ne.east - sw.east,
      depth: ne.north - sw.north,
      centerEast: (ne.east + sw.east) / 2,
      centerNorth: (ne.north + sw.north) / 2,
    };
  }, [origin, tile]);

  return (
    <mesh
      position={[placement.centerEast, lift, -placement.centerNorth]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      frustumCulled={false}
    >
      <planeGeometry args={[placement.width, placement.depth, segments, segments]} />
    </mesh>
  );
}

/** A square ring of tiles around the tile containing `origin`. */
function TileRing({
  origin,
  zoom,
  ring,
  segments,
  lift,
  uniforms,
}: {
  origin: LonLat;
  zoom: number;
  ring: number;
  segments: number;
  lift: number;
  uniforms: BendUniforms;
}) {
  const tiles = useMemo(() => {
    const center = lonLatToTile(origin.lon, origin.lat, zoom);
    const n = 2 ** zoom;
    const out: TileKey[] = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const x = (((center.x + dx) % n) + n) % n;
        const y = center.y + dy;
        if (y < 0 || y >= n) continue;
        out.push({ z: zoom, x, y });
      }
    }
    return out;
  }, [origin, zoom, ring]);

  return (
    <>
      {tiles.map((tile) => (
        <TilePlane
          key={`${tile.z}/${tile.x}/${tile.y}`}
          origin={origin}
          tile={tile}
          segments={segments}
          lift={lift}
          uniforms={uniforms}
        />
      ))}
    </>
  );
}

/** Thin accent cross at the user point. Not bent: it sits at the origin. */
function OriginCross({ size = 200 }: { size?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const h = size / 2;
    const y = NEAR_LIFT_M + 2; // just above the near ring to avoid z-fighting
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
  origin: LonLat;
  view: React.RefObject<ViewState>;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const rotation = useRef<THREE.Group>(null);
  const translation = useRef<THREE.Group>(null);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const state = useMapStore.getState();
    view.current.heading = easeAngleDeg(view.current.heading, state.heading, dt, reducedMotion);
    if (rotation.current) rotation.current.rotation.y = (view.current.heading * Math.PI) / 180;
    if (translation.current) {
      const offset = lonLatToEnu(origin, state.userPoint);
      translation.current.position.set(-offset.east, 0, offset.north);
    }
  });

  return (
    <group ref={rotation} name="worldRoot">
      <group ref={translation}>{children}</group>
    </group>
  );
}

function NavigationDriver({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const nav = useKeyboardNavigation(target);
  useFrame((_, rawDt) => nav.step(Math.min(rawDt, 0.1)));
  return null;
}

function BentWorld({
  origin,
  view,
  reducedMotion,
}: {
  origin: LonLat;
  view: React.RefObject<ViewState>;
  reducedMotion: boolean;
}) {
  const uniforms = useBendUniforms(view);
  return (
    <WorldRoot origin={origin} view={view} reducedMotion={reducedMotion}>
      <TileRing
        origin={origin}
        zoom={FAR_ZOOM}
        ring={FAR_RING}
        segments={FAR_SEGMENTS}
        lift={0}
        uniforms={uniforms}
      />
      <TileRing
        origin={origin}
        zoom={NEAR_ZOOM}
        ring={NEAR_RING}
        segments={NEAR_SEGMENTS}
        lift={NEAR_LIFT_M}
        uniforms={uniforms}
      />
    </WorldRoot>
  );
}

export default function BentWorldCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // The ENU origin is the user point at mount; navigation moves the world root.
  const origin = useMemo<LonLat>(() => ({ ...useMapStore.getState().userPoint }), []);
  const initial = useMapStore.getState();
  const view = useRef<ViewState>({ height: initial.cameraHeight, heading: initial.heading });
  const initialAhead = lookAheadMeters(initial.cameraHeight, initial.userPointScreenFraction);

  return (
    <div ref={container} className="h-full w-full" tabIndex={0} aria-label="Bent World">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
        camera={{
          fov: CAMERA_FOV_DEG,
          near: 1,
          far: 400_000,
          position: [0, initial.cameraHeight, -initialAhead],
          up: [0, 0, -1],
        }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <CameraRig view={view} reducedMotion={reducedMotion} />
        <NavigationDriver target={container} />
        <BentWorld origin={origin} view={view} reducedMotion={reducedMotion} />
        <OriginCross />
      </Canvas>
    </div>
  );
}

// Client-only three.js canvas for the Bent World view. Loaded lazily by
// BentWorldScene so nothing here ever runs on the server.
//
// Camera model (Knowledge → Architecture decisions): the camera is FIXED,
// looking straight down at the origin; the world root rotates by heading and is
// translated so that mapStore.userPoint sits at the origin. Scene axes:
// x = east, y = up, z = -north.
//
// Phase 0.7: one flat textured Kartverket tile, no elevation, no bending yet.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { useReducedMotion } from "@/lib/motion";
import {
  lonLatToEnu,
  lonLatToTile,
  tileToLonLatBounds,
  type LonLat,
} from "@/map/engine/projection";
import { useMapStore } from "@/map/store/mapStore";

import { useKeyboardNavigation } from "./useKeyboardNavigation";

const BACKGROUND = "#0A0E17";
const ACCENT = "#3FE8B0";
const PLACEHOLDER = "#151A26"; // card tone while the tile loads
const TILE_ZOOM = 12;
const EASE_RATE = 8; // 1 - exp(-dt * EASE_RATE)

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

/** Fixed camera straight above the origin; only its height animates. */
function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera);
  const height = useRef(useMapStore.getState().cameraHeight);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const target = useMapStore.getState().cameraHeight;
    height.current = ease(height.current, target, dt, reducedMotion);
    camera.position.set(0, height.current, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
  });

  return null;
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

/** One Kartverket topo tile as a flat plane, placed in ENU metres around `origin`. */
function TilePlane({ origin }: { origin: LonLat }) {
  const tile = useMemo(() => lonLatToTile(origin.lon, origin.lat, TILE_ZOOM), [origin]);
  const texture = useTextureSafe(kartverketTileUrl("topo", tile.z, tile.x, tile.y));

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
      position={[placement.centerEast, 0, -placement.centerNorth]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[placement.width, placement.depth]} />
      {texture ? (
        <meshBasicMaterial map={texture} toneMapped={false} />
      ) : (
        <meshBasicMaterial color={PLACEHOLDER} toneMapped={false} />
      )}
    </mesh>
  );
}

/** Thin accent cross at the origin so the user point is visible. */
function OriginCross({ size = 200 }: { size?: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const h = size / 2;
    const y = 2; // just above the plane to avoid z-fighting
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
  reducedMotion,
  children,
}: {
  origin: LonLat;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const rotation = useRef<THREE.Group>(null);
  const translation = useRef<THREE.Group>(null);
  const heading = useRef(useMapStore.getState().heading);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const state = useMapStore.getState();
    heading.current = easeAngleDeg(heading.current, state.heading, dt, reducedMotion);
    if (rotation.current) rotation.current.rotation.y = (heading.current * Math.PI) / 180;
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

export default function BentWorldCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  // The ENU origin is the user point at mount; navigation moves the world root.
  const origin = useMemo<LonLat>(() => ({ ...useMapStore.getState().userPoint }), []);
  const initialHeight = useMapStore.getState().cameraHeight;

  return (
    <div ref={container} className="h-full w-full" tabIndex={0} aria-label="Bent World">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 50, near: 1, far: 200_000, position: [0, initialHeight, 0], up: [0, 0, -1] }}
      >
        <color attach="background" args={[BACKGROUND]} />
        <CameraRig reducedMotion={reducedMotion} />
        <NavigationDriver target={container} />
        <WorldRoot origin={origin} reducedMotion={reducedMotion}>
          <TilePlane origin={origin} />
        </WorldRoot>
        <OriginCross />
      </Canvas>
    </div>
  );
}

// Pointer navigation for the Bent World scene: drag to pan (left button / one
// finger), drag with the right button, middle button, Shift or Ctrl to rotate the
// heading. Panning grabs the ground under the pointer and keeps it under the
// pointer; releasing keeps a little momentum. Must run inside the Canvas (needs
// the camera). Writes only through mapStore.

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { enuToLonLat } from "@/map/engine/projection";
import { effectiveCameraHeight, useMapStore } from "@/map/store/mapStore";

import { groundHit, sceneDeltaToEnu, toNdc } from "./dragMath";
import { turnTo } from "./rotation";

const ROTATE_DEG_PER_PX = 0.3;
/** Momentum decays as exp(-dt · MOMENTUM_DECAY). */
const MOMENTUM_DECAY = 5;
const MOMENTUM_STOP_MPS = 2;
/** Ground hits farther than this many camera heights from the user point are ignored. */
const MAX_HIT_HEIGHTS = 4;

export interface PointerNavigation {
  /** Call once per frame with the frame delta in seconds (applies momentum). */
  step: (dt: number) => void;
}

interface DragState {
  pointerId: number;
  mode: "pan" | "rotate";
  lastX: number;
  lastY: number;
  /** last ground hit in scene space (pan) */
  lastHit: { x: number; z: number } | null;
  /** recent pan velocity in ENU metres/second */
  velocity: { east: number; north: number };
  lastMoveMs: number;
}

export function usePointerNavigation(
  target: React.RefObject<HTMLElement | null>,
  camera: THREE.Camera,
): PointerNavigation {
  const drag = useRef<DragState | null>(null);
  const momentum = useRef<{ east: number; north: number } | null>(null);
  const raycaster = useRef(new THREE.Raycaster());

  useEffect(() => {
    const element = target.current;
    if (!element) return;

    const hitAt = (clientX: number, clientY: number): { x: number; z: number } | null => {
      const rect = element.getBoundingClientRect();
      const ndc = toNdc(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
      raycaster.current.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const ray = raycaster.current.ray;
      const maxDistance = MAX_HIT_HEIGHTS * effectiveCameraHeight(useMapStore.getState());
      const hit = groundHit(ray.origin, ray.direction, maxDistance);
      return hit ? { x: hit.x, z: hit.z } : null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      const rotate = event.button !== 0 || event.shiftKey || event.ctrlKey;
      element.setPointerCapture(event.pointerId);
      element.focus({ preventScroll: true });
      useMapStore.getState().cancelFlight();
      momentum.current = null;
      drag.current = {
        pointerId: event.pointerId,
        mode: rotate ? "rotate" : "pan",
        lastX: event.clientX,
        lastY: event.clientY,
        lastHit: rotate ? null : hitAt(event.clientX, event.clientY),
        velocity: { east: 0, north: 0 },
        lastMoveMs: performance.now(),
      };
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.pointerId) return;
      const state = useMapStore.getState();
      const now = performance.now();
      const dt = Math.max(1e-3, (now - d.lastMoveMs) / 1000);

      if (d.mode === "rotate") {
        const dx = event.clientX - d.lastX;
        const turned = turnTo(state, state.heading + dx * ROTATE_DEG_PER_PX);
        state.setHeading(turned.heading);
        if (turned.userPoint !== state.userPoint) state.setUserPoint(turned.userPoint);
      } else {
        const hit = hitAt(event.clientX, event.clientY);
        if (hit && d.lastHit) {
          // keep the grabbed ground point under the pointer: move the user the other way
          const enu = sceneDeltaToEnu(hit.x - d.lastHit.x, hit.z - d.lastHit.z, state.heading);
          const east = -enu.east;
          const north = -enu.north;
          const next = enuToLonLat(state.userPoint, { east, north });
          state.setUserPoint({ lat: next.lat, lon: next.lon });
          // velocity estimate (smoothed) for the momentum after release
          const k = 0.5;
          d.velocity = {
            east: d.velocity.east + (east / dt - d.velocity.east) * k,
            north: d.velocity.north + (north / dt - d.velocity.north) * k,
          };
        }
        // the camera is fixed and the world moved under the pointer, so the grabbed ground
        // point now sits exactly at this hit: re-grab there
        d.lastHit = hit ?? d.lastHit;
      }
      d.lastX = event.clientX;
      d.lastY = event.clientY;
      d.lastMoveMs = now;
    };

    const endDrag = (event: PointerEvent) => {
      const d = drag.current;
      if (!d || event.pointerId !== d.pointerId) return;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
      if (d.mode === "pan" && performance.now() - d.lastMoveMs < 120) {
        momentum.current = { ...d.velocity };
      }
      drag.current = null;
    };

    const onContextMenu = (event: Event) => event.preventDefault();

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    element.addEventListener("contextmenu", onContextMenu);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endDrag);
      element.removeEventListener("pointercancel", endDrag);
      element.removeEventListener("contextmenu", onContextMenu);
    };
  }, [target, camera]);

  const step = (dt: number) => {
    const m = momentum.current;
    if (!m) return;
    const decay = Math.exp(-dt * MOMENTUM_DECAY);
    m.east *= decay;
    m.north *= decay;
    if (Math.hypot(m.east, m.north) < MOMENTUM_STOP_MPS) {
      momentum.current = null;
      return;
    }
    const state = useMapStore.getState();
    const next = enuToLonLat(state.userPoint, { east: m.east * dt, north: m.north * dt });
    state.setUserPoint({ lat: next.lat, lon: next.lon });
  };

  return { step };
}

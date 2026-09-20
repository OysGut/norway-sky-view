// Keyboard + wheel navigation for the Bent World scene.
// WASD moves the user point (camera-relative), Q/E rotate heading, wheel changes
// camera height. Writes only through mapStore setters; the scene reads the store.

import { useEffect, useRef } from "react";

import { enuToLonLat } from "@/map/engine/projection";
import { effectiveCameraHeight, useMapStore } from "@/map/store/mapStore";

import { turnTo } from "./rotation";

const ROTATE_DEG_PER_SECOND = 60;

const NAV_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

/**
 * True when the focused element should keep the key for itself: text fields take
 * every key; buttons, sliders and toggle groups take the arrow keys (roving focus,
 * slider steps) but let WASD/Q/E through so the map still moves after a click.
 */
function isTypingOrAdjusting(active: Element | null, key: string): boolean {
  if (!active || active === document.body) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((active as HTMLElement).isContentEditable) return true;
  if (!key.startsWith("arrow")) return false;
  if (tag === "BUTTON") return true;
  const role = active.getAttribute("role");
  return role === "slider" || role === "radio" || role === "switch" || role === "tab";
}

export interface KeyboardNavigation {
  /** Call once per frame with the frame delta in seconds. */
  step: (dt: number) => void;
}

export function useKeyboardNavigation(
  target: React.RefObject<HTMLElement | null>,
): KeyboardNavigation {
  const pressed = useRef(new Set<string>());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!NAV_KEYS.has(key)) return;
      if (isTypingOrAdjusting(document.activeElement, key)) return;
      pressed.current.add(key);
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressed.current.delete(event.key.toLowerCase());
    };
    const onBlur = () => pressed.current.clear();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const s = useMapStore.getState();
      s.cancelFlight();
      const factor = event.deltaY > 0 ? 1.1 : 0.9;
      if (s.cameraMode === "absolute") s.setCameraAltitude(s.cameraAltitude * factor);
      else s.setCameraHeight(s.cameraHeight * factor);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [target]);

  const step = (dt: number) => {
    const keys = pressed.current;
    if (keys.size === 0) return;
    const state = useMapStore.getState();
    state.cancelFlight(); // manual navigation always wins over a flight

    // Rotation
    let turn = 0;
    if (keys.has("q") || keys.has("arrowleft")) turn -= 1;
    if (keys.has("e") || keys.has("arrowright")) turn += 1;
    if (turn !== 0) {
      // turn about the view's pivot (screen centre in Himinrond, the user point otherwise)
      const turned = turnTo(state, state.heading + turn * ROTATE_DEG_PER_SECOND * dt);
      state.setHeading(turned.heading);
      if (turned.userPoint !== state.userPoint) state.setUserPoint(turned.userPoint);
    }

    // Translation, camera-relative (forward = direction of heading)
    let forward = 0;
    let strafe = 0;
    if (keys.has("w") || keys.has("arrowup")) forward += 1;
    if (keys.has("s") || keys.has("arrowdown")) forward -= 1;
    if (keys.has("d")) strafe += 1;
    if (keys.has("a")) strafe -= 1;
    if (forward === 0 && strafe === 0) return;

    const speed = effectiveCameraHeight(state) * 0.5; // m/s
    const length = Math.hypot(forward, strafe) || 1;
    const distance = (speed * dt) / length;
    const headingRad = (state.heading * Math.PI) / 180;
    // heading 0 = north; heading 90 = east. Forward vector in ENU:
    const fEast = Math.sin(headingRad);
    const fNorth = Math.cos(headingRad);
    // right-hand strafe vector (heading + 90°)
    const rEast = Math.cos(headingRad);
    const rNorth = -Math.sin(headingRad);

    const east = (fEast * forward + rEast * strafe) * distance;
    const north = (fNorth * forward + rNorth * strafe) * distance;
    const next = enuToLonLat(state.userPoint, { east, north });
    state.setUserPoint({ lat: next.lat, lon: next.lon });
  };

  return { step };
}

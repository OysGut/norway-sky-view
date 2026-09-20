// Client-side hydration of the persisted map store (mode, view settings, presets).
// The store skips automatic hydration so server and first client render agree;
// mount this hook once on any page that shows the map.

import { useEffect } from "react";

import { hydrateMapStore } from "./mapStore";

export function useMapStoreHydration(): void {
  useEffect(() => {
    void hydrateMapStore();
  }, []);
}

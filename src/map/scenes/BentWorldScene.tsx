// The signature Bent World three.js scene (flat map bending into a real horizon).
// SSR-safe wrapper: the WebGL canvas module is loaded lazily and only on the client.

import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const BentWorldCanvas = lazy(() => import("./BentWorldCanvas"));

function Fallback() {
  return <div className="h-full w-full bg-background" aria-hidden="true" />;
}

export function BentWorldScene() {
  return (
    <ClientOnly fallback={<Fallback />}>
      <Suspense fallback={<Fallback />}>
        <BentWorldCanvas />
      </Suspense>
    </ClientOnly>
  );
}

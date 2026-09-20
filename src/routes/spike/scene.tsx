// SPIKE route: hosts the real BentWorldScene while the main page is still the wordmark.
import { createFileRoute } from "@tanstack/react-router";

import { BentWorldScene } from "@/map/scenes/BentWorldScene";
import { BendControls } from "@/map/ui/BendControls";
import { CameraControls } from "@/map/ui/CameraControls";
import { GlassPanel } from "@/map/ui/GlassPanel";
import { LanguageSwitch } from "@/map/ui/LanguageSwitch";
import { NavigationHud } from "@/map/ui/NavigationHud";
import { ThemeToggle } from "@/map/ui/ThemeToggle";

export const Route = createFileRoute("/spike/scene")({
  head: () => ({
    meta: [
      { title: "Scene spike — Himinrond" },
      { name: "description", content: "Internal diagnostic page: first three.js scene." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpikeScenePage,
});

function SpikeScenePage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <BentWorldScene />
      </div>
      <div className="absolute left-4 top-4 z-10 flex w-72 flex-col gap-3">
        <NavigationHud />
        <CameraControls />
      </div>
      <BendControls className="absolute bottom-4 right-4 z-10 w-72" />
      <GlassPanel className="absolute right-4 top-4 z-10 flex items-center gap-2" padding="sm">
        <LanguageSwitch />
        <ThemeToggle />
      </GlassPanel>
    </main>
  );
}

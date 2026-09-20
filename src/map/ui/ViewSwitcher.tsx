import { useTranslation } from "react-i18next";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAP_MODES, useMapStore, type MapMode } from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";

interface ViewSwitcherProps {
  className?: string | undefined;
}

const LABEL_KEY: Record<MapMode, string> = {
  bent: "view.bent",
  classic3d: "view.classic3d",
  "2d": "view.flat",
};

/** One-click switch between Bent World, classic 3D and top-down. Each mode remembers its settings. */
export function ViewSwitcher({ className }: ViewSwitcherProps) {
  const { t } = useTranslation();
  const mode = useMapStore((s) => s.mode);
  const setMode = useMapStore((s) => s.setMode);

  return (
    <GlassPanel padding="sm" className={className}>
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v: string) => {
          if ((MAP_MODES as readonly string[]).includes(v)) setMode(v as MapMode);
        }}
        aria-label={t("view.title")}
        className="flex gap-1"
      >
        {MAP_MODES.map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            size="sm"
            className="h-8 px-3 text-xs data-[state=on]:bg-accent/15 data-[state=on]:text-accent"
            data-testid={`view-${m}`}
          >
            {t(LABEL_KEY[m])}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </GlassPanel>
  );
}

import { useTranslation } from "react-i18next";

import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMeters } from "@/i18n/format";
import { useLanguage } from "@/i18n/useLanguage";
import {
  CAMERA_ALTITUDE_MAX,
  CAMERA_ALTITUDE_MIN,
  CAMERA_HEIGHT_MAX,
  CAMERA_HEIGHT_MIN,
  useMapStore,
  type CameraMode,
} from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";

interface CameraControlsProps {
  className?: string | undefined;
}

/** Log-scale slider mapping: 0..1000 ↔ [min, max]. */
const STEPS = 1000;
function toSlider(v: number, min: number, max: number): number {
  return Math.round((Math.log(v / min) / Math.log(max / min)) * STEPS);
}
function fromSlider(s: number, min: number, max: number): number {
  return min * Math.pow(max / min, s / STEPS);
}

/** Camera height mode (follow terrain / fixed altitude) and the active height. */
export function CameraControls({ className }: CameraControlsProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const mode = useMapStore((s) => s.cameraMode);
  const cameraHeight = useMapStore((s) => s.cameraHeight);
  const cameraAltitude = useMapStore((s) => s.cameraAltitude);
  const setCameraMode = useMapStore((s) => s.setCameraMode);
  const setCameraHeight = useMapStore((s) => s.setCameraHeight);
  const setCameraAltitude = useMapStore((s) => s.setCameraAltitude);

  const absolute = mode === "absolute";
  const min = absolute ? CAMERA_ALTITUDE_MIN : CAMERA_HEIGHT_MIN;
  const max = absolute ? CAMERA_ALTITUDE_MAX : CAMERA_HEIGHT_MAX;
  const value = absolute ? cameraAltitude : cameraHeight;
  const label = absolute ? t("camera.altitude") : t("camera.heightAboveGround");

  return (
    <GlassPanel padding="sm" className={className}>
      <div className="grid gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("camera.title")}
        </span>
        <div className="flex items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v: string) => {
              if (v === "terrain" || v === "absolute") setCameraMode(v as CameraMode);
            }}
            aria-label={t("camera.title")}
            className="grid w-full grid-cols-2 gap-1"
          >
            <ToggleGroupItem
              value="terrain"
              size="sm"
              className="h-7 px-2 text-xs data-[state=on]:bg-accent/15 data-[state=on]:text-accent"
            >
              {t("camera.modeTerrain")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="absolute"
              size="sm"
              className="h-7 px-2 text-xs data-[state=on]:bg-accent/15 data-[state=on]:text-accent"
            >
              {t("camera.modeAbsolute")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <label className="grid gap-1.5 text-xs">
          <span className="flex items-center justify-between text-muted-foreground">
            <span>{label}</span>
            <span className="tabular text-foreground">{formatMeters(value, language)}</span>
          </span>
          <Slider
            min={0}
            max={STEPS}
            step={1}
            value={[toSlider(value, min, max)]}
            onValueChange={([s]) => {
              if (s === undefined) return;
              const v = fromSlider(s, min, max);
              if (absolute) setCameraAltitude(v);
              else setCameraHeight(v);
            }}
            aria-label={label}
          />
        </label>
      </div>
    </GlassPanel>
  );
}

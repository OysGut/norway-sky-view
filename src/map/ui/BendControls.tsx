import { useTranslation } from "react-i18next";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatMeters, formatNumber } from "@/i18n/format";
import { useLanguage } from "@/i18n/useLanguage";
import { bendParamsFromView, horizonDistance } from "@/map/engine/bendMath";
import { WIREFRAME_LAYER } from "@/map/scenes/cameraModel";
import { useMapStore, type BendSettings } from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";
import { Readout } from "./Readout";

interface BendControlsProps {
  className?: string | undefined;
}

type NumericBendKey = "flatFraction" | "radiusFraction" | "compressionFraction" | "drama";

interface SliderSpec {
  key: NumericBendKey;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: readonly SliderSpec[] = [
  { key: "flatFraction", min: 0.02, max: 0.6, step: 0.01 },
  { key: "radiusFraction", min: 0.05, max: 1.2, step: 0.01 },
  { key: "compressionFraction", min: 0.005, max: 0.5, step: 0.005 },
  { key: "drama", min: 0, max: 1, step: 0.05 },
];

function ControlRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs">
      <span className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular text-foreground">{value}</span>
      </span>
      {children}
    </label>
  );
}

/** Live tuning of the Bent World parameters. Writes only through mapStore. */
export function BendControls({ className }: BendControlsProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const bend = useMapStore((s) => s.bend);
  const cameraHeight = useMapStore((s) => s.cameraHeight);
  const userPointScreenFraction = useMapStore((s) => s.userPointScreenFraction);
  const setBend = useMapStore((s) => s.setBend);
  const setUserPointScreenFraction = useMapStore((s) => s.setUserPointScreenFraction);
  const wireframe = useMapStore((s) => s.layers[WIREFRAME_LAYER] === true);
  const setLayer = useMapStore((s) => s.setLayer);

  const params = bendParamsFromView(cameraHeight, bend, bend.enabled);
  const horizonKm = horizonDistance(params) / 1000;

  const set = (key: keyof BendSettings, value: number) =>
    setBend({ [key]: value } as Partial<BendSettings>);

  return (
    <GlassPanel padding="sm" className={className}>
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t("bend.title")}
          </span>
          <Switch
            checked={bend.enabled >= 0.5}
            onCheckedChange={(checked) => set("enabled", checked ? 1 : 0)}
            aria-label={t("bend.enabled")}
          />
        </div>

        {SLIDERS.map((spec) => (
          <ControlRow
            key={spec.key}
            label={t(`bend.${spec.key}`)}
            value={formatNumber(bend[spec.key], spec.step < 0.01 ? 3 : 2, language)}
          >
            <Slider
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={[bend[spec.key]]}
              onValueChange={([v]) => {
                if (v !== undefined) set(spec.key, v);
              }}
              aria-label={t(`bend.${spec.key}`)}
            />
          </ControlRow>
        ))}

        <ControlRow
          label={t("bend.userPointScreenFraction")}
          value={formatNumber(userPointScreenFraction, 2, language)}
        >
          <Slider
            min={0.1}
            max={0.5}
            step={0.01}
            value={[userPointScreenFraction]}
            onValueChange={([v]) => {
              if (v !== undefined) setUserPointScreenFraction(v);
            }}
            aria-label={t("bend.userPointScreenFraction")}
          />
        </ControlRow>

        <label className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("bend.backward")}</span>
          <Switch
            checked={bend.backwardWeight >= 0.5}
            onCheckedChange={(checked) => set("backwardWeight", checked ? 1 : 0)}
            aria-label={t("bend.backward")}
          />
        </label>

        <label className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("bend.wireframe")}</span>
          <Switch
            checked={wireframe}
            onCheckedChange={(checked) => setLayer(WIREFRAME_LAYER, checked)}
            aria-label={t("bend.wireframe")}
          />
        </label>

        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
          <Readout label={t("bend.flatM")} value={formatMeters(params.flatM, language)} size="sm" />
          <Readout
            label={t("bend.radiusM")}
            value={formatMeters(params.radiusM, language)}
            size="sm"
          />
          <Readout
            label={t("bend.horizon")}
            value={`${formatNumber(horizonKm, horizonKm < 10 ? 1 : 0, language)} km`}
            size="sm"
          />
        </div>
      </div>
    </GlassPanel>
  );
}

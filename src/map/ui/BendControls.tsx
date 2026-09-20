import { useTranslation } from "react-i18next";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formatMeters, formatNumber } from "@/i18n/format";
import { useLanguage } from "@/i18n/useLanguage";
import { bendParamsFromView } from "@/map/engine/bendMath";
import { CAMERA_FOV_DEG, SYNTHETIC_LAYER, WIREFRAME_LAYER } from "@/map/scenes/cameraModel";
import { effectiveCameraHeight, useMapStore, type BendSettings } from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";
import { Readout } from "./Readout";

interface BendControlsProps {
  className?: string | undefined;
}

type NumericBendKey =
  | "horizonScreenFraction"
  | "horizonDistanceM"
  | "flatFraction"
  | "transitionFraction"
  | "curveExponent"
  | "drama";

interface SliderSpec {
  key: NumericBendKey;
  min: number;
  max: number;
  step: number;
  /** How to print the value */
  format: (v: number, language: "nb" | "en") => string;
}

const SLIDERS: readonly SliderSpec[] = [
  {
    key: "horizonScreenFraction",
    min: 0.3,
    max: 1,
    step: 0.01,
    format: (v, l) => formatNumber(v, 2, l),
  },
  {
    key: "horizonDistanceM",
    min: 5_000,
    max: 400_000,
    step: 5_000,
    format: (v, l) => `${formatNumber(v / 1000, 0, l)} km`,
  },
  { key: "flatFraction", min: 0, max: 0.8, step: 0.01, format: (v, l) => formatNumber(v, 2, l) },
  {
    key: "transitionFraction",
    min: 0,
    max: 0.8,
    step: 0.01,
    format: (v, l) => formatNumber(v, 2, l),
  },
  { key: "curveExponent", min: 0.4, max: 2.5, step: 0.05, format: (v, l) => formatNumber(v, 2, l) },
  { key: "drama", min: 0, max: 1, step: 0.05, format: (v, l) => formatNumber(v, 2, l) },
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
  const cameraHeight = useMapStore(effectiveCameraHeight);
  const userPointScreenFraction = useMapStore((s) => s.userPointScreenFraction);
  const setBend = useMapStore((s) => s.setBend);
  const setUserPointScreenFraction = useMapStore((s) => s.setUserPointScreenFraction);
  const wireframe = useMapStore((s) => s.layers[WIREFRAME_LAYER] === true);
  const synthetic = useMapStore((s) => s.layers[SYNTHETIC_LAYER] === true);
  const setLayer = useMapStore((s) => s.setLayer);

  const params = bendParamsFromView(
    cameraHeight,
    bend,
    { userPointScreenFraction, fovDeg: CAMERA_FOV_DEG },
    bend.enabled,
  );

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
            value={spec.format(bend[spec.key], language)}
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
            min={-0.6}
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
          <span>{t("bend.curvature")}</span>
          <Switch
            checked={bend.physicalCurvature}
            onCheckedChange={(checked) => setBend({ physicalCurvature: checked })}
            aria-label={t("bend.curvature")}
          />
        </label>

        <label className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("bend.synthetic")}</span>
          <Switch
            checked={synthetic}
            onCheckedChange={(checked) => setLayer(SYNTHETIC_LAYER, checked)}
            aria-label={t("bend.synthetic")}
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
            label={t("bend.compressionM")}
            value={formatMeters(params.compressionM, language)}
            size="sm"
          />
        </div>
      </div>
    </GlassPanel>
  );
}

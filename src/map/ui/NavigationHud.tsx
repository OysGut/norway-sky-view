import { useTranslation } from "react-i18next";

import { formatCoordinate, formatMeters, formatNumber } from "@/i18n/format";
import { useLanguage } from "@/i18n/useLanguage";
import { useMapStore } from "@/map/store/mapStore";

import { GlassPanel } from "./GlassPanel";
import { Readout } from "./Readout";

interface NavigationHudProps {
  className?: string;
}

export function NavigationHud({ className }: NavigationHudProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const userPoint = useMapStore((s) => s.userPoint);
  const heading = useMapStore((s) => s.heading);
  const cameraHeight = useMapStore((s) => s.cameraHeight);

  return (
    <GlassPanel padding="sm" className={className}>
      <div className="grid gap-3">
        <Readout
          label={t("hud.position")}
          value={formatCoordinate(userPoint.lat, userPoint.lon, language)}
          size="sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <Readout
            label={t("hud.heading")}
            value={`${formatNumber(heading, 0, language)}°`}
            size="sm"
          />
          <Readout label={t("hud.height")} value={formatMeters(cameraHeight, language)} size="sm" />
        </div>
        <p className="text-[11px] text-muted-foreground">{t("hud.keys")}</p>
      </div>
    </GlassPanel>
  );
}
